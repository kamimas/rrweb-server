-- Migration: Add AI analysis and chat support to problem cohorts
--
-- Adds:
--   - ai_report column to campaign_problems (stores generated markdown report)
--   - ai_analyzed_at column to campaign_problems (tracks when analysis was run)
--   - problem_chat_messages table (stores chat history for follow-up questions)
--
-- Usage:
--   psql -U rrweb -d rrweb_sessions -f docs/migrations/006_add_problem_analysis.sql

-- 1. Add AI columns to campaign_problems
ALTER TABLE campaign_problems
ADD COLUMN IF NOT EXISTS ai_report TEXT,
ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMP WITH TIME ZONE;

-- 2. Create chat messages table
CREATE TABLE IF NOT EXISTS problem_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    problem_id UUID NOT NULL REFERENCES campaign_problems(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,                        -- 'user' or 'assistant'
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create index for fast chat history retrieval
CREATE INDEX IF NOT EXISTS idx_problem_chat_problem_id ON problem_chat_messages(problem_id);

-- 4. Verification
SELECT 'ai_report column added:' as check_type,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_name = 'campaign_problems' AND column_name = 'ai_report') as result;

SELECT 'problem_chat_messages table created:' as check_type,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'problem_chat_messages') as result;
