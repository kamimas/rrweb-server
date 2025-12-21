-- Migration: Add Problem Cohorts feature
-- Adds campaign_id to sessions + creates problem cohort tables
--
-- Usage:
--   psql -U rrweb -d rrweb_sessions -f docs/migrations/003_add_problem_cohorts.sql

-- =============================================================================
-- STEP 1: Add campaign_id to sessions table
-- =============================================================================
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS campaign_id INTEGER;

-- =============================================================================
-- STEP 2: Backfill campaign_id from session_chunks
-- Uses DISTINCT + LIMIT 1 to handle edge cases (should be 1:1 in practice)
-- =============================================================================
UPDATE sessions s
SET campaign_id = (
    SELECT DISTINCT sc.campaign_id
    FROM session_chunks sc
    WHERE sc.session_id = s.session_id
    AND sc.campaign_id IS NOT NULL
    LIMIT 1
)
WHERE s.campaign_id IS NULL;

-- =============================================================================
-- STEP 3: Add foreign key constraint with CASCADE delete
-- Deleting a campaign will now delete all its sessions
-- =============================================================================
ALTER TABLE sessions
ADD CONSTRAINT fk_sessions_campaign
FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;

-- Index for efficient campaign-based queries
CREATE INDEX IF NOT EXISTS idx_sessions_campaign_id ON sessions(campaign_id);

-- =============================================================================
-- STEP 4: Create campaign_problems table (Problem Cohorts)
-- =============================================================================
CREATE TABLE IF NOT EXISTS campaign_problems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_campaign_problems_campaign_id ON campaign_problems(campaign_id);

-- =============================================================================
-- STEP 5: Create problem_sessions junction table
-- =============================================================================
CREATE TABLE IF NOT EXISTS problem_sessions (
    problem_id UUID REFERENCES campaign_problems(id) ON DELETE CASCADE,
    session_id VARCHAR(255) REFERENCES sessions(session_id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (problem_id, session_id)
);

-- Index for efficient session-based lookups
CREATE INDEX IF NOT EXISTS idx_problem_sessions_session_id ON problem_sessions(session_id);

-- =============================================================================
-- VERIFICATION: Check new structures
-- =============================================================================
SELECT 'sessions.campaign_id added:' as check_type,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name = 'sessions' AND column_name = 'campaign_id') as result;

SELECT 'campaign_problems table created:' as check_type,
       EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_name = 'campaign_problems') as result;

SELECT 'problem_sessions table created:' as check_type,
       EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_name = 'problem_sessions') as result;

-- Count backfilled sessions
SELECT 'Sessions with campaign_id:' as metric, COUNT(*) as count
FROM sessions WHERE campaign_id IS NOT NULL;

