-- Migration: Add device tracking columns to sessions table
-- Parses User-Agent header for OS, browser, and device type
--
-- Usage:
--   psql -U rrweb -d rrweb_sessions -f docs/migrations/002_add_device_columns.sql

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS device_os VARCHAR(50),       -- e.g. "Windows", "iOS", "Android"
ADD COLUMN IF NOT EXISTS device_browser VARCHAR(50),  -- e.g. "Chrome", "Safari"
ADD COLUMN IF NOT EXISTS device_type VARCHAR(20);     -- e.g. "mobile", "tablet", "desktop"

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sessions'
AND column_name IN ('device_os', 'device_browser', 'device_type');
