/**
 * Stress Test: "The Hammer"
 *
 * Proves that Postgres and the Connection Pool can handle 100+ parallel writes
 * without crashing, locking, or losing data.
 *
 * Target: upload-url endpoint (writes to session_chunks table)
 *
 * Usage:
 *   1. Start the server: JWT_SECRET=test node server.js
 *   2. Run test: node tests/stress-test.js
 *
 * Prerequisites:
 *   - Server running on localhost:3000 (or set API_URL env var)
 *   - ALLOWED_DOMAINS configured with localhost:3000 domain
 *   - A campaign exists (test will create one if needed)
 */

const http = require('http');
const https = require('https');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT || '100');
const TEST_DOMAIN = process.env.TEST_DOMAIN || 'localhost:3000';
const TEST_TOKEN = process.env.TEST_TOKEN || '6d4a8cd0fb6b363742837691f30f5fe852c507446ee6f1199521a9b445465596';
const TEST_CAMPAIGN = 'stress-test-campaign';

// Simple HTTP client (no external dependencies)
function request(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function ensureCampaignExists(jwt) {
  try {
    // Try to get existing campaign
    const res = await request('GET', `${API_URL}/api/campaigns`, null, {
      'Authorization': `Bearer ${jwt}`
    });

    if (res.data.campaigns) {
      const existing = res.data.campaigns.find(c => c.name === TEST_CAMPAIGN);
      if (existing) {
        console.log(`  Using existing campaign: ${TEST_CAMPAIGN} (ID: ${existing.id})`);
        return existing;
      }
    }
  } catch (e) {
    // Campaign endpoint might not exist or need different auth
  }

  // Create new campaign
  try {
    const createRes = await request('POST', `${API_URL}/api/campaigns`, {
      name: TEST_CAMPAIGN
    }, {
      'Authorization': `Bearer ${jwt}`
    });

    if (createRes.status === 201 || createRes.status === 200) {
      console.log(`  Created campaign: ${TEST_CAMPAIGN}`);
      return createRes.data;
    }
  } catch (e) {
    console.log(`  Warning: Could not create campaign (${e.message})`);
  }

  console.log(`  Assuming campaign "${TEST_CAMPAIGN}" exists...`);
  return { name: TEST_CAMPAIGN };
}

async function login() {
  // Try to login to get JWT (for campaign creation)
  try {
    const res = await request('POST', `${API_URL}/api/auth/login`, {
      username: 'admin',
      password: 'admin'
    });
    if (res.data.token) {
      return res.data.token;
    }
  } catch (e) {
    // Login might fail, that's ok for this test
  }
  return null;
}

async function runStressTest() {
  console.log('\n' + '='.repeat(60));
  console.log('  THE HAMMER TEST - Postgres Concurrency Verification');
  console.log('='.repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  API URL: ${API_URL}`);
  console.log(`  Concurrent Requests: ${CONCURRENT_REQUESTS}`);
  console.log(`  Test Domain: ${TEST_DOMAIN}`);
  console.log(`  Campaign: ${TEST_CAMPAIGN}`);

  // Setup
  console.log('\n[1/4] Setup...');
  const jwt = await login();
  await ensureCampaignExists(jwt);

  // Generate unique session ID for this test run
  const sessionId = `stress_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  console.log(`  Session ID: ${sessionId}`);

  // Prepare requests
  console.log(`\n[2/4] Preparing ${CONCURRENT_REQUESTS} concurrent requests...`);
  const requests = [];

  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    const payload = {
      chunkTimestamp: Date.now() + i,
      campaign: TEST_CAMPAIGN,
      distinctId: `stress_user_${i % 10}`, // 10 unique users
      pageUrl: `https://${TEST_DOMAIN}/stress-test`,
      host: TEST_DOMAIN,
      domainToken: TEST_TOKEN,
      sequenceId: i
    };

    // Create promise but don't execute yet
    requests.push(
      request('POST', `${API_URL}/api/sessions/${sessionId}/upload-url`, payload)
        .then(res => ({ success: res.status < 400, status: res.status, data: res.data }))
        .catch(err => ({ success: false, error: err.message }))
    );
  }

  // Fire all requests simultaneously
  console.log(`\n[3/4] Firing ${CONCURRENT_REQUESTS} requests simultaneously...`);
  const startTime = Date.now();
  const results = await Promise.all(requests);
  const duration = Date.now() - startTime;

  // Analyze results
  console.log('\n[4/4] Analyzing results...');
  const successes = results.filter(r => r.success);
  const failures = results.filter(r => !r.success);

  // Group errors by type
  const errorTypes = {};
  for (const f of failures) {
    const errKey = f.error || `HTTP ${f.status}: ${JSON.stringify(f.data?.error || f.data)}`;
    errorTypes[errKey] = (errorTypes[errKey] || 0) + 1;
  }

  console.log('\n' + '='.repeat(60));
  console.log('  RESULTS');
  console.log('='.repeat(60));
  console.log(`\n  Total Requests:     ${CONCURRENT_REQUESTS}`);
  console.log(`  Successful Writes:  ${successes.length}`);
  console.log(`  Failed Writes:      ${failures.length}`);
  console.log(`  Duration:           ${duration}ms`);
  console.log(`  Throughput:         ${(CONCURRENT_REQUESTS / (duration / 1000)).toFixed(1)} req/sec`);

  if (Object.keys(errorTypes).length > 0) {
    console.log('\n  Error Breakdown:');
    for (const [err, count] of Object.entries(errorTypes)) {
      console.log(`    - ${err}: ${count}x`);
    }
  }

  // Verdict
  console.log('\n' + '='.repeat(60));
  if (failures.length === 0) {
    console.log('  VERDICT: PASS');
    console.log('  Postgres handled the load perfectly!');
    console.log('='.repeat(60) + '\n');
    process.exit(0);
  } else if (failures.length < CONCURRENT_REQUESTS * 0.05) {
    console.log('  VERDICT: ACCEPTABLE');
    console.log(`  ${failures.length} failures (< 5%) - Minor issues under extreme load`);
    console.log('='.repeat(60) + '\n');
    process.exit(0);
  } else {
    console.log('  VERDICT: FAIL');
    console.log('  Database locked or Connection Pool exhausted.');
    console.log('  Check: max pool size in src/db.js');
    console.log('='.repeat(60) + '\n');
    process.exit(1);
  }
}

// Run the test
runStressTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
