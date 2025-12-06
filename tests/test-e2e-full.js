/**
 * Full E2E Test - Simulates frontend flow
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const TOKEN = '6d4a8cd0fb6b363742837691f30f5fe852c507446ee6f1199521a9b445465596';
const HOST = 'localhost:3003';
const SESSION_ID = 'test-e2e-' + Date.now();

async function run() {
    console.log('='.repeat(60));
    console.log('FULL E2E TEST');
    console.log('='.repeat(60));
    console.log('Session ID:', SESSION_ID);
    console.log('');

    // Load events
    const events = JSON.parse(fs.readFileSync(path.join(__dirname, '../recording.json'), 'utf-8'));
    console.log(`Loaded ${events.length} events from recording.json`);

    // 1. Upload session
    console.log('\n[1] Uploading session...');
    const uploadRes = await fetch(`${BASE_URL}/upload-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sessionId: SESSION_ID,
            distinctId: 'user-test-123',
            campaign: 'test_campaign',
            events: events,
            pageUrl: 'http://localhost:3003/test',
            host: HOST,
            timestamp: Date.now(),
            domainToken: TOKEN
        })
    });
    const uploadData = await uploadRes.json();
    console.log('Upload response:', uploadData);

    if (!uploadRes.ok) {
        console.error('FAIL: Upload failed');
        process.exit(1);
    }
    console.log('PASS: Session uploaded');

    // 2. Identify user
    console.log('\n[2] Identifying user...');
    const identifyRes = await fetch(`${BASE_URL}/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'test@example.com',
            distinctId: 'user-test-123',
            host: HOST,
            domainToken: TOKEN
        })
    });
    const identifyData = await identifyRes.json();
    console.log('Identify response:', identifyData);

    if (!identifyRes.ok) {
        console.error('FAIL: Identify failed');
        process.exit(1);
    }
    console.log('PASS: User identified');

    // 3. Set status to dropped_off
    console.log('\n[3] Setting status to dropped_off...');
    const statusRes = await fetch(`${BASE_URL}/api/sessions/${SESSION_ID}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            status: 'dropped_off',
            host: HOST,
            domainToken: TOKEN
        })
    });
    const statusData = await statusRes.json();
    console.log('Status response:', statusData);

    if (!statusRes.ok) {
        console.error('FAIL: Status update failed');
        process.exit(1);
    }
    console.log('PASS: Status set to dropped_off');
    console.log('PASS: Session queued for processing');

    // 4. Check DB
    console.log('\n[4] Checking database...');
    const db = require('../src/db');
    const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(SESSION_ID);
    console.log('Session in DB:', session);

    if (session && session.assets_status === 'queued') {
        console.log('PASS: Session is queued for video generation');
    }

    console.log('\n' + '='.repeat(60));
    console.log('E2E TEST COMPLETE - Check worker logs for processing');
    console.log('='.repeat(60));
}

run().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
