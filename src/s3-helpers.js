/**
 * S3 Helper Functions for Session Processing
 *
 * Provides utilities for fetching merged session events and uploading processed assets.
 */

const fs = require('fs');

/**
 * Fetch and merge all session chunks from S3.
 * Chunks are sorted by timestamp to ensure correct event ordering.
 *
 * @param {string} sessionId - The session ID to fetch
 * @param {object} db - better-sqlite3 database instance
 * @param {object} s3 - AWS S3 client instance
 * @returns {Promise<{events: Array, bucket: string, campaignId: number}>}
 */
async function fetchMergedSession(sessionId, db, s3) {
    // Get all chunks for this session, ordered by timestamp
    const query = `
        SELECT s3_key, s3_bucket, campaign_id, timestamp
        FROM session_chunks
        WHERE session_id = ?
        ORDER BY timestamp ASC
    `;
    const chunks = db.prepare(query).all(sessionId);

    if (chunks.length === 0) {
        throw new Error(`No chunks found for session: ${sessionId}`);
    }

    // Filter valid chunks (must have s3_key and s3_bucket)
    const validChunks = chunks.filter(chunk => chunk.s3_key && chunk.s3_bucket);
    if (validChunks.length === 0) {
        throw new Error(`No valid S3 chunks for session: ${sessionId}`);
    }

    console.log(`[S3] Fetching ${validChunks.length} chunks for session: ${sessionId}`);

    // Fetch all chunks from S3 in parallel
    const chunkPromises = validChunks.map(async (chunk) => {
        try {
            const response = await s3.getObject({
                Bucket: chunk.s3_bucket,
                Key: chunk.s3_key
            }).promise();
            return JSON.parse(response.Body.toString('utf8'));
        } catch (err) {
            console.error(`[S3] Error fetching chunk ${chunk.s3_key}:`, err.message);
            return null;
        }
    });

    const chunkResults = await Promise.all(chunkPromises);

    // Merge all events
    let allEvents = [];
    for (const data of chunkResults) {
        if (data && data.events && Array.isArray(data.events)) {
            allEvents = allEvents.concat(data.events);
        }
    }

    // Sort events by timestamp (handles any out-of-order events)
    allEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    console.log(`[S3] Merged ${allEvents.length} events from ${validChunks.length} chunks`);

    return {
        events: allEvents,
        bucket: validChunks[0].s3_bucket,  // Use bucket from first chunk
        campaignId: validChunks[0].campaign_id
    };
}

/**
 * Upload a local file to S3.
 *
 * @param {string} localPath - Path to local file
 * @param {string} s3Key - S3 object key (path)
 * @param {string} bucket - S3 bucket name
 * @param {object} s3 - AWS S3 client instance
 * @returns {Promise<void>}
 */
async function uploadFile(localPath, s3Key, bucket, s3) {
    const fileContent = fs.readFileSync(localPath);

    // Determine content type based on extension
    const ext = localPath.split('.').pop().toLowerCase();
    const contentTypes = {
        'mp4': 'video/mp4',
        'txt': 'text/plain',
        'json': 'application/json'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    await s3.upload({
        Bucket: bucket,
        Key: s3Key,
        Body: fileContent,
        ContentType: contentType
    }).promise();

    console.log(`[S3] Uploaded: s3://${bucket}/${s3Key}`);
}

/**
 * Get the S3 bucket for a session (from its chunks).
 *
 * @param {string} sessionId - The session ID
 * @param {object} db - better-sqlite3 database instance
 * @returns {string|null} - The bucket name or null if not found
 */
function getSessionBucket(sessionId, db) {
    const result = db.prepare(
        'SELECT s3_bucket FROM session_chunks WHERE session_id = ? LIMIT 1'
    ).get(sessionId);

    return result ? result.s3_bucket : null;
}

module.exports = {
    fetchMergedSession,
    uploadFile,
    getSessionBucket
};
