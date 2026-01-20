-- ========================================
-- Migration: Add user-facing fields to trading_sessions
-- Date: 2025-10-17
-- Description: Adds name, notes, and auto_started fields for improved session management
-- ========================================

-- 1. Add user-friendly name field
ALTER TABLE trading_sessions 
ADD COLUMN IF NOT EXISTS name TEXT;

-- 2. Add notes field for user comments (уже существует в схеме, но добавим IF NOT EXISTS)
ALTER TABLE trading_sessions 
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 3. Add flag to track auto-restored sessions
ALTER TABLE trading_sessions 
ADD COLUMN IF NOT EXISTS auto_started BOOLEAN DEFAULT FALSE;

-- 4. Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_sessions_status ON trading_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON trading_sessions(source);
CREATE INDEX IF NOT EXISTS idx_sessions_mode ON trading_sessions(mode);
CREATE INDEX IF NOT EXISTS idx_sessions_created_desc ON trading_sessions("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_name ON trading_sessions(name) WHERE name IS NOT NULL;

-- 5. Add comments for documentation
COMMENT ON COLUMN trading_sessions.name IS 'User-friendly session name for easy identification (e.g. "Test BTC+ETH majors")';
COMMENT ON COLUMN trading_sessions.notes IS 'User notes about session purpose, strategy, or observations';
COMMENT ON COLUMN trading_sessions.auto_started IS 'TRUE if session was automatically restored after server crash/restart';

-- 6. Update existing sessions with default names (based on creation date)
UPDATE trading_sessions 
SET name = CONCAT('Session ', TO_CHAR("createdAt", 'DD.MM.YYYY HH24:MI'))
WHERE name IS NULL AND source = 'scanner';

UPDATE trading_sessions 
SET name = CONCAT('Backtest ', TO_CHAR("createdAt", 'DD.MM.YYYY HH24:MI'))
WHERE name IS NULL AND source = 'backtester';

-- 7. Verify changes
SELECT 
  COUNT(*) as total_sessions,
  COUNT(name) as sessions_with_name,
  COUNT(CASE WHEN auto_started = true THEN 1 END) as auto_started_count,
  COUNT(CASE WHEN source = 'scanner' THEN 1 END) as scanner_sessions,
  COUNT(CASE WHEN source = 'backtester' THEN 1 END) as backtester_sessions
FROM trading_sessions;

-- Expected output: All sessions should have names now
-- Sample output:
--  total_sessions | sessions_with_name | auto_started_count | scanner_sessions | backtester_sessions
-- ----------------+--------------------+--------------------+------------------+---------------------
--              10 |                 10 |                  0 |                5 |                   5
