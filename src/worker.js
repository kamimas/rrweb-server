/**
 * Video Processing Worker
 *
 * Polls the SQLite queue for sessions to process.
 * For each session: fetches events, generates timeline, renders video, uploads to S3.
 *
 * Run with: node src/worker.js
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const AWS = require('aws-sdk');

const queue = require('./queue-manager');
const s3Helpers = require('./s3-helpers');
const { generateTimeline } = require('../timeline-react-aware');
const { renderVideo } = require('../render-worker');

// Configuration
const POLL_INTERVAL_MS = 5000;  // Check for work every 5 seconds
const TEMP_DIR = path.join(__dirname, '../temp');

// Database setup (same path as server.js)
const dbDir = process.env.NODE_ENV === 'production' ? '/app/data' : path.join(__dirname, '..');
const dbPath = path.join(dbDir, 'db.sqlite');

console.log(`[Worker] Connecting to database: ${dbPath}`);
const db = new Database(dbPath);

// Enable WAL mode for concurrent access with server
db.pragma('journal_mode = WAL');

// AWS S3 setup
AWS.config.update({ region: process.env.AWS_REGION });
const s3 = new AWS.S3();

/**
 * Process a single session: fetch, render, upload.
 */
async function processSession(sessionId) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Worker] Processing session: ${sessionId}`);
    console.log(`${'='.repeat(60)}`);

    // Mark as processing
    queue.markProcessing(sessionId, db);

    // Create temp directory for this session
    const sessionTempDir = path.join(TEMP_DIR, sessionId);
    if (!fs.existsSync(sessionTempDir)) {
        fs.mkdirSync(sessionTempDir, { recursive: true });
    }

    try {
        // 1. Fetch merged session events from S3
        console.log(`[Worker] Fetching session data from S3...`);
        const { events, bucket } = await s3Helpers.fetchMergedSession(sessionId, db, s3);

        if (!events || events.length === 0) {
            throw new Error('No events found in session');
        }

        // Save events to temp file for render-worker
        const eventsPath = path.join(sessionTempDir, 'events.json');
        fs.writeFileSync(eventsPath, JSON.stringify(events));
        console.log(`[Worker] Saved ${events.length} events to temp file`);

        // 2. Generate Timeline (Text)
        console.log(`[Worker] Generating timeline...`);
        const timelineText = generateTimeline(events);
        const timelinePath = path.join(sessionTempDir, 'timeline.txt');
        fs.writeFileSync(timelinePath, timelineText);
        console.log(`[Worker] Timeline generated (${timelineText.length} chars)`);

        // 3. Render Video (MP4)
        console.log(`[Worker] Rendering video...`);
        const videoPath = await renderVideo(eventsPath, sessionTempDir);
        console.log(`[Worker] Video rendered: ${videoPath}`);

        // 4. Upload to S3
        const videoKey = `sessions/${sessionId}/assets/video.mp4`;
        const timelineKey = `sessions/${sessionId}/assets/timeline.txt`;

        console.log(`[Worker] Uploading assets to S3...`);
        await Promise.all([
            s3Helpers.uploadFile(videoPath, videoKey, bucket, s3),
            s3Helpers.uploadFile(timelinePath, timelineKey, bucket, s3)
        ]);

        // 5. Mark as ready
        queue.markReady(sessionId, videoKey, timelineKey, db);

        console.log(`[Worker] Session complete: ${sessionId}`);
        console.log(`[Worker] Video: s3://${bucket}/${videoKey}`);
        console.log(`[Worker] Timeline: s3://${bucket}/${timelineKey}`);

    } catch (err) {
        console.error(`[Worker] Error processing ${sessionId}:`, err.message);
        queue.markFailed(sessionId, db);
    } finally {
        // Cleanup temp files
        if (fs.existsSync(sessionTempDir)) {
            fs.rmSync(sessionTempDir, { recursive: true, force: true });
            console.log(`[Worker] Cleaned up temp directory`);
        }
    }
}

/**
 * Main polling loop.
 */
async function startWorker() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Worker] Video Processing Worker Started`);
    console.log(`[Worker] Poll interval: ${POLL_INTERVAL_MS}ms`);
    console.log(`[Worker] Temp directory: ${TEMP_DIR}`);
    console.log(`${'='.repeat(60)}\n`);

    // Ensure temp directory exists
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    // Clean up any stale temp directories on startup
    const staleFiles = fs.readdirSync(TEMP_DIR);
    if (staleFiles.length > 0) {
        console.log(`[Worker] Cleaning up ${staleFiles.length} stale temp directories...`);
        for (const file of staleFiles) {
            fs.rmSync(path.join(TEMP_DIR, file), { recursive: true, force: true });
        }
    }

    // Log initial queue stats
    const stats = queue.getQueueStats(db);
    console.log(`[Worker] Queue stats: ${JSON.stringify(stats)}`);

    // Polling loop
    while (true) {
        try {
            const sessionId = queue.getNextJob(db);

            if (sessionId) {
                await processSession(sessionId);
            } else {
                // No jobs, wait before checking again
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            }
        } catch (err) {
            console.error(`[Worker] Unexpected error in poll loop:`, err.message);
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Worker] Shutting down...');
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[Worker] Shutting down...');
    db.close();
    process.exit(0);
});

// Start the worker
startWorker().catch(err => {
    console.error('[Worker] Fatal error:', err);
    process.exit(1);
});
