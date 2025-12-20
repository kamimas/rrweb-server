-- Migration: Add location tracking columns to sessions table
-- Run this on existing PostgreSQL databases to enable IP geolocation
--
-- Usage:
--   psql -U rrweb -d rrweb_sessions -f docs/migrations/001_add_location_columns.sql

-- Add location columns
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS location_country VARCHAR(2),     -- ISO 2-letter code (US, CA, FR)
ADD COLUMN IF NOT EXISTS location_city VARCHAR(100),      -- City name (Toronto, San Francisco)
ADD COLUMN IF NOT EXISTS location_region VARCHAR(100),    -- State/Province code (ON, CA)
ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);          -- IPv6/IPv4 (optional, for audit)

-- Add index for country filtering (common query pattern)
CREATE INDEX IF NOT EXISTS idx_sessions_location_country ON sessions(location_country);

-- Update the view to include location data
CREATE OR REPLACE VIEW sessions_with_users AS
SELECT
    s.session_id,
    s.status,
    s.watched,
    s.assets_status,
    s.ai_diagnosis,
    s.furthest_step_index,
    s.location_country,
    s.location_city,
    s.location_region,
    u.email as user_email,
    sc.campaign_id,
    c.name as campaign_name,
    MIN(sc.timestamp) as start_time,
    MAX(sc.timestamp) as end_time,
    COUNT(sc.id) as chunk_count
FROM sessions s
LEFT JOIN session_chunks sc ON s.session_id = sc.session_id
LEFT JOIN aliases a ON sc.distinct_id = a.distinct_id
LEFT JOIN users u ON a.user_id = u.id
LEFT JOIN campaigns c ON sc.campaign_id = c.id
GROUP BY s.session_id, u.email, sc.campaign_id, c.name;

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sessions'
AND column_name IN ('location_country', 'location_city', 'location_region', 'ip_address');

-- =============================================================================
-- GDPR COMPLIANCE: IP Address Auto-Nullification (Optional but Recommended)
-- =============================================================================
-- IP addresses are PII under GDPR. Since we extract country/city on ingest,
-- the raw IP is only needed for bot banning. Consider running this daily:
--
--   UPDATE sessions SET ip_address = NULL WHERE updated_at < EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days') * 1000;
--
-- Or create a scheduled function (requires pg_cron extension):
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('nullify-old-ips', '0 3 * * *',
--   $$UPDATE sessions SET ip_address = NULL WHERE updated_at < EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days') * 1000$$
-- );

-- =============================================================================
-- GEOIP DATABASE UPDATES (MaxMind License Required)
-- =============================================================================
-- The geoip-lite database ships with npm but becomes stale over time.
-- To update:
--   1. Register at https://www.maxmind.com/en/geolite2/signup
--   2. Get your license key from Account > Manage License Keys
--   3. Set in .env: GEOLITE2_LICENSE_KEY=your_key_here
--   4. Run: npm run update-geoip
--
-- Recommended: Run monthly via cron to keep IP→location mappings accurate.
