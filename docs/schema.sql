-- PostgreSQL Schema for rrweb-server
-- Run this script to initialize a fresh PostgreSQL database
--
-- Usage:
--   psql -U rrweb -d rrweb_sessions -f docs/schema.sql
--
-- Or via Docker:
--   docker exec -i rrweb-postgres psql -U rrweb -d rrweb_sessions < docs/schema.sql

-- =============================================================================
-- CAMPAIGNS TABLE
-- Stores recording campaigns/funnels with AI analysis configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    created_at BIGINT NOT NULL,

    -- AI Analysis Configuration
    mission_brief TEXT,                           -- Free-text funnel description for AI
    generated_rubric TEXT,                        -- AI-generated analysis categories (JSON)
    ai_report TEXT,                               -- Full AI analysis report (markdown)
    ai_analysis_status VARCHAR(50) DEFAULT 'pending', -- pending, analyzing, complete, error

    -- Funnel Tracking
    funnel_config TEXT,                           -- Step definitions for funnel tracking (JSON)

    -- Campaign State
    is_paused BOOLEAN DEFAULT FALSE               -- Paused campaigns don't record new sessions
);

CREATE INDEX IF NOT EXISTS idx_campaigns_name ON campaigns(name);

-- =============================================================================
-- USERS TABLE
-- Stores identified users (by email)
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- ALIASES TABLE
-- Links anonymous distinct_ids to identified users
-- =============================================================================
CREATE TABLE IF NOT EXISTS aliases (
    distinct_id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aliases_user_id ON aliases(user_id);

-- =============================================================================
-- SESSIONS TABLE
-- Stores session metadata and status
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(255) PRIMARY KEY,         -- Client-generated session ID

    -- Status Tracking
    status VARCHAR(50),                           -- NULL, completed, dropped_off
    watched BOOLEAN DEFAULT FALSE,
    watched_at BIGINT,
    updated_at BIGINT,

    -- Asset Processing Status
    assets_status VARCHAR(50) DEFAULT 'raw',      -- raw, queued, processing, ready, failed
    video_s3_key VARCHAR(512),                    -- S3 key for rendered video
    timeline_s3_key VARCHAR(512),                 -- S3 key for timeline text

    -- AI Analysis Results (per-session)
    ai_diagnosis TEXT,                            -- AI-identified drop-off reason
    ai_evidence TEXT,                             -- Evidence supporting diagnosis
    ai_last_step TEXT,                            -- Last step before drop-off
    ai_progress INTEGER,                          -- Progress percentage (0-100)

    -- Funnel Progress Tracking
    furthest_step_index INTEGER DEFAULT -1        -- Index of furthest step reached
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_assets_status ON sessions(assets_status);

-- =============================================================================
-- SESSION CHUNKS TABLE
-- Pointers to S3-stored event chunks
-- =============================================================================
CREATE TABLE IF NOT EXISTS session_chunks (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,             -- References sessions.session_id
    distinct_id VARCHAR(255) NOT NULL,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
    s3_key VARCHAR(512) UNIQUE NOT NULL,
    s3_bucket VARCHAR(255) NOT NULL,
    page_url TEXT,
    timestamp BIGINT NOT NULL,                    -- Client timestamp for ordering
    sequence_id INTEGER,                          -- Client-assigned chunk sequence (0, 1, 2...)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_chunks_session_id ON session_chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_session_chunks_distinct_id ON session_chunks(distinct_id);
CREATE INDEX IF NOT EXISTS idx_session_chunks_campaign_id ON session_chunks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_session_chunks_timestamp ON session_chunks(timestamp);

-- Prevent duplicate chunks within a session (data integrity)
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_sequence ON session_chunks(session_id, sequence_id)
    WHERE sequence_id IS NOT NULL;

-- =============================================================================
-- CAMPAIGN RULES TABLE
-- Visual editor rules for autopilot SDK
-- =============================================================================
CREATE TABLE IF NOT EXISTS campaign_rules (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    trigger_type VARCHAR(50) NOT NULL,            -- CLICK_ELEMENT, URL_CONTAINS
    selector TEXT NOT NULL,                       -- CSS selector or URL pattern
    action_type VARCHAR(50) NOT NULL,             -- START_RECORDING, STOP_RECORDING, LOG_STEP
    step_key VARCHAR(255),                        -- Step identifier for LOG_STEP
    timeout_ms INTEGER,                           -- Recording timeout in milliseconds (for START_RECORDING)
    completion_status VARCHAR(50),                -- 'completed' or 'dropped_off' (for STOP_RECORDING)
    is_active BOOLEAN DEFAULT FALSE,              -- Rules are drafts until published
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaign_rules_campaign_id ON campaign_rules(campaign_id);

-- =============================================================================
-- SESSION STEPS TABLE
-- Tracks step-by-step journey for each session (for funnel analytics)
-- =============================================================================
CREATE TABLE IF NOT EXISTS session_steps (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,             -- References sessions.session_id
    step_key VARCHAR(255) NOT NULL,               -- Step identifier from funnel_config
    step_index INTEGER NOT NULL,                  -- Index in funnel_config array
    visited_at TIMESTAMPTZ DEFAULT NOW(),         -- When the step was reached
    UNIQUE(session_id, step_key)                  -- One entry per step per session
);

CREATE INDEX IF NOT EXISTS idx_session_steps_session_id ON session_steps(session_id);

-- =============================================================================
-- HELPER VIEWS (Optional, for convenience)
-- =============================================================================

-- View: Sessions with user emails
CREATE OR REPLACE VIEW sessions_with_users AS
SELECT
    s.session_id,
    s.status,
    s.watched,
    s.assets_status,
    s.ai_diagnosis,
    s.furthest_step_index,
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

-- =============================================================================
-- NOTES ON MIGRATION FROM SQLITE
-- =============================================================================
-- 1. INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
-- 2. TEXT -> VARCHAR(n) or TEXT (use VARCHAR for indexed columns)
-- 3. INTEGER for timestamps -> BIGINT (to handle JS milliseconds)
-- 4. ? placeholders -> $1, $2, etc.
-- 5. .get() -> queryOne() (returns rows[0])
-- 6. .all() -> query().rows
-- 7. .run() -> query() or insert()
-- 8. All operations are now ASYNC - use await!
