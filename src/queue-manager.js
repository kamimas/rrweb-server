/**
 * SQLite-based Queue Manager for Video Processing
 *
 * Uses the sessions.assets_status column as the queue state:
 * - 'raw': No processing needed (completed sessions)
 * - 'queued': Waiting for worker to pick up
 * - 'processing': Worker is currently processing
 * - 'ready': Processing complete, assets available
 * - 'failed': Processing failed
 */

/**
 * Add a session to the processing queue.
 * Creates session record if it doesn't exist.
 *
 * @param {string} sessionId - The session ID to queue
 * @param {object} db - better-sqlite3 database instance
 */
function addJob(sessionId, db) {
    const now = Date.now();

    // Upsert: create or update session to 'queued' status
    db.prepare(`
        INSERT INTO sessions (session_id, assets_status, updated_at)
        VALUES (?, 'queued', ?)
        ON CONFLICT(session_id) DO UPDATE SET
            assets_status = 'queued',
            updated_at = ?
    `).run(sessionId, now, now);

    console.log(`[Queue] Added job: ${sessionId}`);
}

/**
 * Get the next job to process (FIFO order by updated_at).
 *
 * @param {object} db - better-sqlite3 database instance
 * @returns {string|null} - Session ID or null if no jobs available
 */
function getNextJob(db) {
    const result = db.prepare(`
        SELECT session_id
        FROM sessions
        WHERE assets_status = 'queued'
        ORDER BY updated_at ASC
        LIMIT 1
    `).get();

    return result ? result.session_id : null;
}

/**
 * Mark a session as currently being processed.
 *
 * @param {string} sessionId - The session ID
 * @param {object} db - better-sqlite3 database instance
 */
function markProcessing(sessionId, db) {
    db.prepare(`
        UPDATE sessions
        SET assets_status = 'processing', updated_at = ?
        WHERE session_id = ?
    `).run(Date.now(), sessionId);

    console.log(`[Queue] Processing: ${sessionId}`);
}

/**
 * Mark a session as ready (processing complete).
 *
 * @param {string} sessionId - The session ID
 * @param {string} videoKey - S3 key for the video file
 * @param {string} timelineKey - S3 key for the timeline file
 * @param {object} db - better-sqlite3 database instance
 */
function markReady(sessionId, videoKey, timelineKey, db) {
    db.prepare(`
        UPDATE sessions
        SET assets_status = 'ready',
            video_s3_key = ?,
            timeline_s3_key = ?,
            updated_at = ?
        WHERE session_id = ?
    `).run(videoKey, timelineKey, Date.now(), sessionId);

    console.log(`[Queue] Ready: ${sessionId}`);
}

/**
 * Mark a session as failed.
 *
 * @param {string} sessionId - The session ID
 * @param {object} db - better-sqlite3 database instance
 */
function markFailed(sessionId, db) {
    db.prepare(`
        UPDATE sessions
        SET assets_status = 'failed', updated_at = ?
        WHERE session_id = ?
    `).run(Date.now(), sessionId);

    console.log(`[Queue] Failed: ${sessionId}`);
}

/**
 * Get queue statistics.
 *
 * @param {object} db - better-sqlite3 database instance
 * @returns {object} - Counts by status
 */
function getQueueStats(db) {
    const result = db.prepare(`
        SELECT
            COUNT(CASE WHEN assets_status = 'queued' THEN 1 END) as queued,
            COUNT(CASE WHEN assets_status = 'processing' THEN 1 END) as processing,
            COUNT(CASE WHEN assets_status = 'ready' THEN 1 END) as ready,
            COUNT(CASE WHEN assets_status = 'failed' THEN 1 END) as failed,
            COUNT(CASE WHEN assets_status = 'raw' THEN 1 END) as raw
        FROM sessions
    `).get();

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
