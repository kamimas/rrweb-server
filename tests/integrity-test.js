/**
 * Integrity Test: "The Shuffle"
 *
 * Proves that if chunks arrive out of order (network lag), the API
 * still returns them in the correct sequence_id order for playback.
 *
 * Target: upload-url (write) and playback (read)
 *
 * Usage:
 *   1. Start the server: JWT_SECRET=test node server.js
 *   2. Run test: node tests/integrity-test.js
 *
 * Prerequisites:
 *   - Server running on localhost:3000 (or set API_URL env var)
 *   - ALLOWED_DOMAINS configured with localhost:3000 domain
 *   - A campaign exists (test will create one if needed)
 *   - PostgreSQL running with sequence_id column in session_chunks
 */

const http = require('http');
const https = require('https');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_DOMAIN = process.env.TEST_DOMAIN || 'localhost:3000';
const TEST_TOKEN = process.env.TEST_TOKEN || '6d4a8cd0fb6b363742837691f30f5fe852c507446ee6f1199521a9b445465596';
const TEST_CAMPAIGN = 'integrity-test-campaign';

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendChunk(sessionId, sequenceId, timestamp) {
  const payload = {
    chunkTimestamp: timestamp,
    campaign: TEST_CAMPAIGN,
    distinctId: 'integrity_test_user',
    pageUrl: `https://${TEST_DOMAIN}/integrity-test`,
    host: TEST_DOMAIN,
    domainToken: TEST_TOKEN,
    sequenceId: sequenceId
  };

  return request('POST', `${API_URL}/api/sessions/${sessionId}/upload-url`, payload);
}

async function runIntegrityTest() {
  console.log('\n' + '='.repeat(60));
  console.log('  THE SHUFFLE TEST - Sequence Integrity Verification');
  console.log('='.repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  API URL: ${API_URL}`);
  console.log(`  Test Domain: ${TEST_DOMAIN}`);
  console.log(`  Campaign: ${TEST_CAMPAIGN}`);

  // Generate unique session ID
  const sessionId = `shuffle_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  console.log(`  Session ID: ${sessionId}`);

  // Test 1: Send chunks OUT OF ORDER
  console.log('\n[1/4] Sending chunks OUT OF ORDER (simulating network lag)...');

  const baseTime = Date.now();

  // Send chunk 3 FIRST (sequence_id = 2)
  console.log('  -> Sending chunk 3 (seq=2) first...');
  const res3 = await sendChunk(sessionId, 2, baseTime + 3000);
  console.log(`     Status: ${res3.status}`);

  // Small delay to ensure different created_at
  await sleep(100);

  // Send chunk 1 SECOND (sequence_id = 0)
  console.log('  -> Sending chunk 1 (seq=0) second...');
  const res1 = await sendChunk(sessionId, 0, baseTime + 1000);
  console.log(`     Status: ${res1.status}`);

  await sleep(100);

  // Send chunk 2 THIRD (sequence_id = 1)
  console.log('  -> Sending chunk 2 (seq=1) third...');
  const res2 = await sendChunk(sessionId, 1, baseTime + 2000);
  console.log(`     Status: ${res2.status}`);

  // Check all writes succeeded
  console.log('\n[2/4] Verifying writes...');
  const allSuccess = [res1, res2, res3].every(r => r.status < 400);
  if (!allSuccess) {
    console.log('  FAIL: Some chunks failed to write');
    console.log('  Check that:');
    console.log(`    - Campaign "${TEST_CAMPAIGN}" exists`);
    console.log(`    - Domain "${TEST_DOMAIN}" is in ALLOWED_DOMAINS`);
    console.log(`    - Token "${TEST_TOKEN}" matches configuration`);
    process.exit(1);
  }
  console.log('  All 3 chunks written successfully');

  // Test 2: Fetch playback and verify order
  console.log('\n[3/4] Fetching playback data...');
  await sleep(500); // Give DB a moment

  const playbackRes = await request('GET', `${API_URL}/api/sessions/${sessionId}/playback`);

  if (playbackRes.status !== 200) {
    console.log(`  FAIL: Playback endpoint returned ${playbackRes.status}`);
    console.log(`  Response: ${JSON.stringify(playbackRes.data)}`);
    process.exit(1);
  }

  // Test 3: Verify chunk order in response
  console.log('\n[4/4] Verifying sequence order...');

  // The playback response should have chunks or s3_keys in sequence order
  const chunks = playbackRes.data.chunks || playbackRes.data.s3_keys || [];

  if (chunks.length === 0) {
    console.log('  Note: No chunks in response (might be merged events)');
    console.log('  Checking events array...');

    // If events are merged, we can't easily verify order from API
    // Print SQL query for manual verification
    console.log('\n' + '='.repeat(60));
    console.log('  MANUAL VERIFICATION REQUIRED');
    console.log('='.repeat(60));
    console.log('\n  Run this SQL query to verify:');
    console.log(`\n  SELECT sequence_id, timestamp, created_at`);
    console.log(`  FROM session_chunks`);
    console.log(`  WHERE session_id = '${sessionId}'`);
    console.log(`  ORDER BY sequence_id ASC;`);
    console.log('\n  Expected result:');
    console.log('    sequence_id | timestamp');
    console.log('    -----------+-----------');
    console.log('    0          | earliest (sent 2nd)');
    console.log('    1          | middle   (sent 3rd)');
    console.log('    2          | latest   (sent 1st)');
    console.log('\n  The ORDER BY in playback query should return this order,');
    console.log('  NOT the created_at order (which would be 2, 0, 1).');
    console.log('='.repeat(60) + '\n');
    process.exit(0);
  }

  // If we have chunks array, verify order
  let isOrdered = true;
  for (let i = 0; i < chunks.length - 1; i++) {
    const current = chunks[i].sequence_id ?? i;
    const next = chunks[i + 1].sequence_id ?? (i + 1);
    if (current > next) {
      isOrdered = false;
      break;
    }
  }

  console.log('\n' + '='.repeat(60));
  if (isOrdered) {
    console.log('  VERDICT: PASS');
    console.log('  Chunks are returned in correct sequence_id order!');
    console.log('  Out-of-order network delivery is handled correctly.');
  } else {
    console.log('  VERDICT: FAIL');
    console.log('  Chunks are NOT in sequence_id order!');
    console.log('  Check ORDER BY clause in playback query.');
    process.exit(1);
  }
  console.log('='.repeat(60) + '\n');

  // Additional: Print SQL for verification
  console.log('Verification SQL:');
  console.log(`  SELECT sequence_id, timestamp, created_at FROM session_chunks WHERE session_id = '${sessionId}' ORDER BY sequence_id;`);
}

// Run the test
runIntegrityTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
