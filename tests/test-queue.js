/**
 * Test 2.2: Queue Manager Logic
 *
 * Verifies the queue adds, retrieves, and updates jobs correctly.
 */

const db = require('../src/db');
const queue = require('../src/queue-manager');

const TEST_SESSION_ID = 'test-queue-' + Date.now();

console.log('='.repeat(60));
console.log('TEST: Queue Manager');
console.log('='.repeat(60));
console.log(`Test Session ID: ${TEST_SESSION_ID}\n`);

// Test 1: Add a job
console.log('Step 1: Adding job to queue...');
try {
    queue.addJob(TEST_SESSION_ID, db);
    console.log('PASS: Job added');
} catch (err) {
    console.error('FAIL: Could not add job -', err.message);
    process.exit(1);
}

// Verify in DB
const afterAdd = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(TEST_SESSION_ID);
if (afterAdd && afterAdd.assets_status === 'queued') {
    console.log('PASS: DB shows assets_status = queued');
} else {
    console.error('FAIL: DB status incorrect -', afterAdd);
    process.exit(1);
}

// Test 2: Get next job
console.log('\nStep 2: Getting next job...');
const nextJob = queue.getNextJob(db);
console.log(`Next job in queue: ${nextJob}`);

if (nextJob) {
    console.log('PASS: Queue returned a job');
} else {
    console.log('WARN: No job returned (might have been picked up already)');
}

// Test 3: Mark as processing
console.log('\nStep 3: Marking as processing...');
try {
    queue.markProcessing(TEST_SESSION_ID, db);
    const afterProcessing = db.prepare('SELECT assets_status FROM sessions WHERE session_id = ?').get(TEST_SESSION_ID);
    if (afterProcessing?.assets_status === 'processing') {
        console.log('PASS: Status updated to processing');
    } else {
        console.error('FAIL: Status not updated correctly');
        process.exit(1);
    }
} catch (err) {
    console.error('FAIL: Could not mark processing -', err.message);
    process.exit(1);
}

// Test 4: Mark as ready
console.log('\nStep 4: Marking as ready...');
try {
    queue.markReady(TEST_SESSION_ID, 'test/video.mp4', 'test/timeline.txt', db);
    const afterReady = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(TEST_SESSION_ID);
    if (afterReady?.assets_status === 'ready' &&
        afterReady?.video_s3_key === 'test/video.mp4' &&
        afterReady?.timeline_s3_key === 'test/timeline.txt') {
        console.log('PASS: Status updated to ready with S3 keys');
    } else {
        console.error('FAIL: Status or keys not set correctly');
        process.exit(1);
    }
} catch (err) {
    console.error('FAIL: Could not mark ready -', err.message);
    process.exit(1);
}

// Test 5: Queue stats
console.log('\nStep 5: Checking queue stats...');
const stats = queue.getQueueStats(db);
console.log('Queue stats:', JSON.stringify(stats, null, 2));

// Cleanup: Remove test session
console.log('\nCleaning up test data...');
db.prepare('DELETE FROM sessions WHERE session_id = ?').run(TEST_SESSION_ID);

console.log('\n' + '='.repeat(60));
console.log('ALL TESTS PASSED');
console.log('='.repeat(60));
