/**
 * Test 4: API Decision Logic
 *
 * Tests the core logic: drop-off -> queued, completed -> raw
 * Without requiring the full HTTP server stack.
 */

const db = require('../src/db');
const queue = require('../src/queue-manager');

console.log('='.repeat(60));
console.log('TEST: API Decision Logic');
console.log('='.repeat(60));

const TEST_DROPOFF_ID = 'test-dropoff-' + Date.now();
const TEST_COMPLETE_ID = 'test-complete-' + Date.now();

// Simulate the logic from server.js POST /api/sessions/:id/status
function simulateStatusUpdate(sessionId, status) {
    const now = Date.now();

    // Upsert session (same as server.js upsertSessionStatus)
    db.prepare(`
        INSERT INTO sessions (session_id, status, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
    `).run(sessionId, status, now);

    // Decision logic (same as server.js)
    if (status === 'dropped_off') {
        queue.addJob(sessionId, db);
        return 'queued';
    } else {
        db.prepare("UPDATE sessions SET assets_status = 'raw' WHERE session_id = ?").run(sessionId);
        return 'raw';
    }
}

// Test 1: Drop-off should queue
console.log('\nTest 4.1: Drop-off Trigger');
console.log(`Session: ${TEST_DROPOFF_ID}`);

const dropoffResult = simulateStatusUpdate(TEST_DROPOFF_ID, 'dropped_off');
const dropoffRow = db.prepare('SELECT status, assets_status FROM sessions WHERE session_id = ?').get(TEST_DROPOFF_ID);

console.log(`  status: ${dropoffRow.status}`);
console.log(`  assets_status: ${dropoffRow.assets_status}`);

if (dropoffRow.status === 'dropped_off' && dropoffRow.assets_status === 'queued') {
    console.log('PASS: Drop-off correctly queued for processing');
} else {
    console.error('FAIL: Drop-off should have assets_status = queued');
    process.exit(1);
}

// Test 2: Completed should stay raw
console.log('\nTest 4.2: Completion Trigger (Cost Saver)');
console.log(`Session: ${TEST_COMPLETE_ID}`);

const completeResult = simulateStatusUpdate(TEST_COMPLETE_ID, 'completed');
const completeRow = db.prepare('SELECT status, assets_status FROM sessions WHERE session_id = ?').get(TEST_COMPLETE_ID);

console.log(`  status: ${completeRow.status}`);
console.log(`  assets_status: ${completeRow.assets_status}`);

if (completeRow.status === 'completed' && completeRow.assets_status === 'raw') {
    console.log('PASS: Completed correctly marked as raw (no processing)');
} else {
    console.error('FAIL: Completed should have assets_status = raw');
    process.exit(1);
}

// Test 3: Manual trigger for completed session
console.log('\nTest 4.3: Manual Generate-Assets Trigger');
console.log(`Session: ${TEST_COMPLETE_ID} (was completed/raw)`);

queue.addJob(TEST_COMPLETE_ID, db);
const afterManualRow = db.prepare('SELECT assets_status FROM sessions WHERE session_id = ?').get(TEST_COMPLETE_ID);

console.log(`  assets_status after manual trigger: ${afterManualRow.assets_status}`);

if (afterManualRow.assets_status === 'queued') {
    console.log('PASS: Manual trigger correctly queued completed session');
} else {
    console.error('FAIL: Manual trigger should queue the session');
    process.exit(1);
}

// Cleanup
console.log('\nCleaning up test data...');
db.prepare('DELETE FROM sessions WHERE session_id IN (?, ?)').run(TEST_DROPOFF_ID, TEST_COMPLETE_ID);

console.log('\n' + '='.repeat(60));
console.log('ALL TESTS PASSED');
console.log('='.repeat(60));
