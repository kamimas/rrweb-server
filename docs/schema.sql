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
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,  -- Parent campaign

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
    furthest_step_index INTEGER DEFAULT -1,       -- Index of furthest step reached

    -- Location Data (IP Geolocation)
    location_country VARCHAR(2),                  -- ISO 2-letter code (US, CA, FR)
    location_city VARCHAR(100),                   -- City name (Toronto, San Francisco)
    location_region VARCHAR(100),                 -- State/Province code (ON, CA)
    ip_address VARCHAR(45),                       -- IPv6/IPv4 (optional, for audit)

    -- Device Data (User-Agent parsing)
    device_os VARCHAR(50),                        -- e.g. "Windows", "iOS", "Android"
    device_browser VARCHAR(50),                   -- e.g. "Chrome", "Safari"
    device_type VARCHAR(20)                       -- e.g. "mobile", "tablet", "desktop"
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_assets_status ON sessions(assets_status);
CREATE INDEX IF NOT EXISTS idx_sessions_location_country ON sessions(location_country);
CREATE INDEX IF NOT EXISTS idx_sessions_campaign_id ON sessions(campaign_id);

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
-- CAMPAIGN PROBLEMS TABLE (Problem Cohorts)
-- Manual cohorts for curating sessions as evidence for specific problems
-- =============================================================================
CREATE TABLE IF NOT EXISTS campaign_problems (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- AI Analysis
    ai_report TEXT,                                   -- Generated markdown analysis report
    ai_analyzed_at TIMESTAMP WITH TIME ZONE          -- When analysis was last run
);

CREATE INDEX IF NOT EXISTS idx_campaign_problems_campaign_id ON campaign_problems(campaign_id);

-- =============================================================================
-- PROBLEM SESSIONS TABLE (Junction)
-- Links sessions to problem cohorts (many-to-many)
-- =============================================================================
CREATE TABLE IF NOT EXISTS problem_sessions (
    problem_id UUID REFERENCES campaign_problems(id) ON DELETE CASCADE,
    session_id VARCHAR(255) REFERENCES sessions(session_id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (problem_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_problem_sessions_session_id ON problem_sessions(session_id);

-- =============================================================================
-- PROBLEM NOTES TABLE (Contextual Notes)
-- Flexible notes scoped to: problem only, session only, or both
-- Note types:
--   - problem_id only   → "Master Note" for that Problem
--   - session_id only   → "General Observation" for that Session
--   - both set          → "Evidence" linking session to problem
-- =============================================================================
CREATE TABLE IF NOT EXISTS problem_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    problem_id UUID REFERENCES campaign_problems(id) ON DELETE CASCADE,
    session_id VARCHAR(255) REFERENCES sessions(session_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    color VARCHAR(20) DEFAULT 'yellow',  -- 'yellow', 'blue', 'green', 'pink'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notes_lookup ON problem_notes(campaign_id, problem_id, session_id);
CREATE INDEX IF NOT EXISTS idx_notes_campaign ON problem_notes(campaign_id);
CREATE INDEX IF NOT EXISTS idx_notes_problem ON problem_notes(problem_id);
CREATE INDEX IF NOT EXISTS idx_notes_session ON problem_notes(session_id);

-- =============================================================================
-- PROBLEM CHAT MESSAGES TABLE
-- Stores chat history for AI conversations about problem analysis
-- =============================================================================
CREATE TABLE IF NOT EXISTS problem_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id UUID NOT NULL REFERENCES campaign_problems(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,                        -- 'user' or 'assistant'
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_problem_chat_problem_id ON problem_chat_messages(problem_id);

-- =============================================================================
-- HELPER VIEWS (Optional, for convenience)
-- =============================================================================

-- View: Sessions with user emails and location
CREATE OR REPLACE VIEW sessions_with_users AS
SELECT
    s.session_id,
    s.campaign_id,
    s.status,
    s.watched,
    s.assets_status,
    s.ai_diagnosis,
    s.furthest_step_index,
    s.location_country,
    s.location_city,
    s.location_region,
    u.email as user_email,
    c.name as campaign_name,
    MIN(sc.timestamp) as start_time,
    MAX(sc.timestamp) as end_time,
    COUNT(sc.id) as chunk_count
FROM sessions s
LEFT JOIN campaigns c ON s.campaign_id = c.id
LEFT JOIN session_chunks sc ON s.session_id = sc.session_id
LEFT JOIN aliases a ON sc.distinct_id = a.distinct_id
LEFT JOIN users u ON a.user_id = u.id
GROUP BY s.session_id, s.campaign_id, u.email, c.name;

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
