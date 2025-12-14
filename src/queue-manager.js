/**
 * PostgreSQL Queue Manager for Video Processing
 *
 * Uses the sessions.assets_status column as the queue state:
 * - 'raw': No processing needed (completed sessions)
 * - 'queued': Waiting for worker to pick up
 * - 'processing': Worker is currently processing
 * - 'ready': Processing complete, assets available
 * - 'failed': Processing failed
 *
 * IMPORTANT: All functions are ASYNC - always use await!
 */

const db = require('./db');

/**
 * Add a session to the processing queue.
 * Creates session record if it doesn't exist.
 *
 * @param {string} sessionId - The session ID to queue
 * @returns {Promise<void>}
 */
async function addJob(sessionId) {
    const now = Date.now();

    // Upsert: create or update session to 'queued' status
    await db.query(`
        INSERT INTO sessions (session_id, assets_status, updated_at)
        VALUES ($1, 'queued', $2)
        ON CONFLICT (session_id) DO UPDATE SET
            assets_status = 'queued',
            updated_at = $3
    `, [sessionId, now, now]);

    console.log(`[Queue] Added job: ${sessionId}`);
}

/**
 * Get the next job to process (FIFO order by updated_at).
 *
 * @returns {Promise<string|null>} - Session ID or null if no jobs available
 */
async function getNextJob() {
    const result = await db.queryOne(`
        SELECT session_id
        FROM sessions
        WHERE assets_status = 'queued'
        ORDER BY updated_at ASC
        LIMIT 1
    `);

    return result ? result.session_id : null;
}

/**
 * Mark a session as currently being processed.
 *
 * @param {string} sessionId - The session ID
 * @returns {Promise<void>}
 */
async function markProcessing(sessionId) {
    await db.query(`
        UPDATE sessions
        SET assets_status = 'processing', updated_at = $1
        WHERE session_id = $2
    `, [Date.now(), sessionId]);

    console.log(`[Queue] Processing: ${sessionId}`);
}

/**
 * Mark a session as ready (processing complete).
 *
 * @param {string} sessionId - The session ID
 * @param {string} videoKey - S3 key for the video file
 * @param {string} timelineKey - S3 key for the timeline file
 * @returns {Promise<void>}
 */
async function markReady(sessionId, videoKey, timelineKey) {
    await db.query(`
        UPDATE sessions
        SET assets_status = 'ready',
            video_s3_key = $1,
            timeline_s3_key = $2,
            updated_at = $3
        WHERE session_id = $4
    `, [videoKey, timelineKey, Date.now(), sessionId]);

    console.log(`[Queue] Ready: ${sessionId}`);
}

/**
 * Mark a session as failed.
 *
 * @param {string} sessionId - The session ID
 * @returns {Promise<void>}
 */
async function markFailed(sessionId) {
    await db.query(`
        UPDATE sessions
        SET assets_status = 'failed', updated_at = $1
        WHERE session_id = $2
    `, [Date.now(), sessionId]);

    console.log(`[Queue] Failed: ${sessionId}`);
}

/**
 * Get queue statistics.
 *
 * @returns {Promise<object>} - Counts by status
 */
async function getQueueStats() {
    const result = await db.queryOne(`
        SELECT
            COUNT(CASE WHEN assets_status = 'queued' THEN 1 END) as queued,
            COUNT(CASE WHEN assets_status = 'processing' THEN 1 END) as processing,
            COUNT(CASE WHEN assets_status = 'ready' THEN 1 END) as ready,
            COUNT(CASE WHEN assets_status = 'failed' THEN 1 END) as failed,
            COUNT(CASE WHEN assets_status = 'raw' THEN 1 END) as raw
        FROM sessions
    `);

    return result;
}

module.exports = {
    addJob,
    getNextJob,
    markProcessing,
    markReady,
    markFailed,
    getQueueStats
};
