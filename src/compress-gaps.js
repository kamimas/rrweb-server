/**
 * Gap Compression Utility for rrweb Events
 *
 * Compresses large gaps in rrweb event timelines to produce more useful video recordings.
 * When a user leaves a page for a long period (e.g., 10+ minutes), the recording would
 * normally have frozen frames. This utility removes that dead time.
 */

// Maximum allowed gap between events (in ms)
const MAX_GAP_MS = 5000; // 5 seconds

/**
 * Compress gaps in rrweb events.
 *
 * Any gap larger than MAX_GAP_MS will be compressed to MAX_GAP_MS.
 * This shifts all subsequent event timestamps to maintain continuity.
 *
 * @param {Array} events - Array of rrweb events with timestamp property
 * @param {number} maxGapMs - Maximum allowed gap in milliseconds (default: 5000)
 * @returns {Array} - New array of events with compressed timestamps
 */
function compressGaps(events, maxGapMs = MAX_GAP_MS) {
    if (!events || events.length === 0) {
        return events;
    }

    // Sort by timestamp first
    const sorted = [...events].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    // Track compression info
    let totalCompressed = 0;
    let gapsCompressed = 0;

    // Create new events with adjusted timestamps
    const compressed = [];
    let adjustment = 0;

    for (let i = 0; i < sorted.length; i++) {
        const event = sorted[i];

        if (i > 0) {
            const prevEvent = sorted[i - 1];
            const gap = event.timestamp - prevEvent.timestamp;

            if (gap > maxGapMs) {
                // Compress this gap
                const compression = gap - maxGapMs;
                adjustment += compression;
                totalCompressed += compression;
                gapsCompressed++;
            }
        }

        // Create new event with adjusted timestamp
        compressed.push({
            ...event,
            timestamp: event.timestamp - adjustment
        });
    }

    if (gapsCompressed > 0) {
        const originalDuration = (sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / 1000;
        const newDuration = (compressed[compressed.length - 1].timestamp - compressed[0].timestamp) / 1000;

        console.log(`[GapCompression] Compressed ${gapsCompressed} gap(s)`);
        console.log(`[GapCompression] Removed ${(totalCompressed / 1000).toFixed(1)}s of dead time`);
        console.log(`[GapCompression] Duration: ${originalDuration.toFixed(1)}s → ${newDuration.toFixed(1)}s`);
    }

    return compressed;
}

/**
 * Analyze gaps in rrweb events.
 *
 * @param {Array} events - Array of rrweb events
 * @returns {Object} - Gap analysis
 */
function analyzeGaps(events) {
    if (!events || events.length < 2) {
        return { gaps: [], totalGapTime: 0 };
    }

    const sorted = [...events].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const gaps = [];
    let totalGapTime = 0;

    for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].timestamp - sorted[i - 1].timestamp;
        if (gap > MAX_GAP_MS) {
            gaps.push({
                from: sorted[i - 1].timestamp,
                to: sorted[i].timestamp,
                duration: gap,
                fromOffset: sorted[i - 1].timestamp - sorted[0].timestamp,
                toOffset: sorted[i].timestamp - sorted[0].timestamp
            });
            totalGapTime += gap - MAX_GAP_MS;
        }
    }

    return {
        gaps,
        totalGapTime,
        originalDuration: sorted[sorted.length - 1].timestamp - sorted[0].timestamp,
        eventCount: events.length
    };
}

module.exports = {
    compressGaps,
    analyzeGaps,
    MAX_GAP_MS
};
