-- Migration: Add contextual notes system
-- Notes can be scoped to: problem only, session only, or both
--
-- Note types based on FK values:
--   - problem_id only   → "Master Note" for that Problem
--   - session_id only   → "General Observation" for that Session
--   - both set          → "Evidence" linking session to problem
--
-- Usage:
--   psql -U rrweb -d rrweb_sessions -f docs/migrations/005_add_problem_notes.sql

-- 1. Create the problem_notes table
CREATE TABLE IF NOT EXISTS problem_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

    -- Nullable FKs for flexible scoping
    problem_id UUID REFERENCES campaign_problems(id) ON DELETE CASCADE,
    session_id VARCHAR(255) REFERENCES sessions(session_id) ON DELETE CASCADE,

    content TEXT NOT NULL,
    color VARCHAR(20) DEFAULT 'yellow',  -- 'yellow', 'blue', 'green', 'pink'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create indexes for fast context-based retrieval
CREATE INDEX IF NOT EXISTS idx_notes_lookup ON problem_notes(campaign_id, problem_id, session_id);
CREATE INDEX IF NOT EXISTS idx_notes_campaign ON problem_notes(campaign_id);
CREATE INDEX IF NOT EXISTS idx_notes_problem ON problem_notes(problem_id);
CREATE INDEX IF NOT EXISTS idx_notes_session ON problem_notes(session_id);

-- 3. Verification
SELECT 'problem_notes table created:' as check_type,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'problem_notes') as result;
