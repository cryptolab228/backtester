-- Add direction column to session_trades table
-- This column stores the trading direction (long/short) for position restoration after server restart

ALTER TABLE session_trades 
ADD COLUMN IF NOT EXISTS direction TEXT;

-- Add index for faster filtering by direction
CREATE INDEX IF NOT EXISTS idx_session_trades_direction ON session_trades(direction);

-- Add comment to explain the column purpose
COMMENT ON COLUMN session_trades.direction IS 'Trading direction: long or short. Required for proper position restoration after server restart.';






