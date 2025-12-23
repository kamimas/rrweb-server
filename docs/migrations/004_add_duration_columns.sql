-- Migration: Add pre-calculated duration and start_hour columns for fast filtering
-- Run this migration, then run the backfill script, then deploy the new server code

-- 1. Add columns to sessions table
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS duration_ms INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS start_hour SMALLINT;

-- 2. Add indexes for instant filtering (O(log n) lookups)
CREATE INDEX IF NOT EXISTS idx_sessions_duration_ms ON sessions(duration_ms);
CREATE INDEX IF NOT EXISTS idx_sessions_start_hour ON sessions(start_hour);

-- 3. Backfill existing sessions from chunk data
UPDATE sessions s
SET
    duration_ms = sub.dur,
    start_hour = sub.st_hour
FROM (
    SELECT
        session_id,
        (MAX(timestamp) - MIN(timestamp))::INTEGER as dur,
        EXTRACT(HOUR FROM TO_TIMESTAMP(MIN(timestamp) / 1000.0))::SMALLINT as st_hour
    FROM session_chunks
    GROUP BY session_id
) sub
WHERE s.session_id = sub.session_id
  AND (s.duration_ms = 0 OR s.duration_ms IS NULL OR s.start_hour IS NULL);
