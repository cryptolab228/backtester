-- Создание таблиц для Backtester v2
-- Автоматически выполняется при запуске приложения

-- Таблица торговых пар
CREATE TABLE IF NOT EXISTS trading_pairs (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    base_asset VARCHAR(20) NOT NULL,
    quote_asset VARCHAR(20) NOT NULL,
    exchange VARCHAR(20) NOT NULL DEFAULT 'okx',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Уникальный составной индекс (symbol + exchange) для поддержки мультибиржи
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_pairs_symbol_exchange ON trading_pairs(symbol, exchange);

-- Добавляем уникальное ограничение для symbol в рамках одной биржи (для ON CONFLICT)
-- ALTER TABLE trading_pairs ADD CONSTRAINT unique_symbol_per_exchange UNIQUE (symbol, exchange);

-- Дополнительные индексы для быстрых запросов
CREATE INDEX IF NOT EXISTS idx_trading_pairs_symbol ON trading_pairs(symbol);
CREATE INDEX IF NOT EXISTS idx_trading_pairs_exchange ON trading_pairs(exchange);
CREATE INDEX IF NOT EXISTS idx_trading_pairs_active ON trading_pairs(is_active);

-- Таблица свечей (основные данные)
CREATE TABLE IF NOT EXISTS candles (
    id BIGSERIAL PRIMARY KEY,
    trading_pair_id INTEGER NOT NULL REFERENCES trading_pairs(id) ON DELETE CASCADE,
    timestamp BIGINT NOT NULL,
    timeframe VARCHAR(10) NOT NULL DEFAULT '1h',
    open DECIMAL(28,18) NOT NULL,
    high DECIMAL(28,18) NOT NULL,
    low DECIMAL(28,18) NOT NULL,
    close DECIMAL(28,18) NOT NULL,
    volume DECIMAL(30,8) NOT NULL DEFAULT 0,
    "volumeQuote" DECIMAL(30,8) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Уникальный индекс для предотвращения дублей (соответствует TypeORM @Index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_candles_unique ON candles(trading_pair_id, timestamp, timeframe);

-- Индексы для быстрых запросов
CREATE INDEX IF NOT EXISTS idx_candles_timestamp ON candles(timestamp);
CREATE INDEX IF NOT EXISTS idx_candles_pair_timestamp ON candles(trading_pair_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_candles_timeframe ON candles(timeframe);

-- Таблица настроек системы
CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    category VARCHAR(100) DEFAULT 'general',
    "exchangeConnections" JSON,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Индекс для настроек
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

-- Вставка базовых настроек по умолчанию (без ON CONFLICT - используем UPSERT через приложение)
DO $$
BEGIN
    INSERT INTO settings (key, value, description, category) VALUES
        ('default_timeframe', '1h', 'Временной интервал по умолчанию', 'data'),
        ('max_candles_per_request', '1000', 'Максимальное количество свечей за один запрос', 'data'),
        ('redis_ttl', '3600', 'TTL для кеширования в Redis (секунды)', 'cache'),
        ('portfolio_initial_balance', '10000', 'Начальный баланс портфеля по умолчанию', 'backtest'),
        ('portfolio_commission', '0.001', 'Комиссия по умолчанию (0.1%)', 'backtest'),
        ('gpu_enabled', 'false', 'Включить GPU ускорение', 'performance'),
        ('max_concurrent_backtests', '3', 'Максимальное количество одновременных бэктестов', 'performance')
    ON CONFLICT (key) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
    -- Игнорируем ошибки дубликатов
    NULL;
END $$;

-- Добавление базовых торговых пар (без ON CONFLICT - используем UPSERT через приложение)
DO $$
BEGIN
    INSERT INTO trading_pairs (symbol, base_asset, quote_asset, exchange) VALUES
        ('BTC-USDT', 'BTC', 'USDT', 'okx'),
        ('ETH-USDT', 'ETH', 'USDT', 'okx'),
        ('BNB-USDT', 'BNB', 'USDT', 'okx'),
        ('ADA-USDT', 'ADA', 'USDT', 'okx'),
        ('SOL-USDT', 'SOL', 'USDT', 'okx'),
        ('DOT-USDT', 'DOT', 'USDT', 'okx'),
        ('MATIC-USDT', 'MATIC', 'USDT', 'okx'),
        ('AVAX-USDT', 'AVAX', 'USDT', 'okx'),
        ('UNI-USDT', 'UNI', 'USDT', 'okx'),
        ('LINK-USDT', 'LINK', 'USDT', 'okx')
    ON CONFLICT (symbol, exchange) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
    -- Игнорируем ошибки дубликатов
    NULL;
END $$;

-- === Сессии сканнера / бэктестера ===

CREATE TYPE session_source AS ENUM ('scanner', 'backtester');
CREATE TYPE session_mode AS ENUM ('dry-run', 'paper', 'shadow', 'demo', 'testnet', 'live', 'backtest');
CREATE TYPE session_status AS ENUM ('running', 'completed', 'failed', 'aborted');

CREATE TABLE IF NOT EXISTS trading_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source session_source NOT NULL,
    mode session_mode NOT NULL,
    "strategyVersion" TEXT,
    "strategyParamsHash" TEXT,
    "strategyParamsSnapshot" JSONB,
    exchange TEXT,
    pairs TEXT[],
    timeframes TEXT[],
    "portfolioMode" BOOLEAN DEFAULT false,
    "configSnapshot" JSONB,
    "riskSettingsSnapshot" JSONB,
    "allocatorConfigSnapshot" JSONB,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "endedAt" TIMESTAMPTZ,
    status session_status NOT NULL DEFAULT 'running',
    notes TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdBy" TEXT
);

CREATE INDEX IF NOT EXISTS idx_trading_sessions_source_mode ON trading_sessions(source, mode);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_started_at ON trading_sessions("startedAt");
CREATE INDEX IF NOT EXISTS idx_trading_sessions_hash ON trading_sessions("strategyParamsHash");

CREATE TYPE trade_status AS ENUM ('open', 'closed', 'cancelled');

CREATE TABLE IF NOT EXISTS session_trades (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES trading_sessions(id) ON DELETE CASCADE,
    source session_source NOT NULL,
    mode TEXT,
    pair TEXT NOT NULL,
    timeframe TEXT,
    direction TEXT,
    exchange TEXT,
    "strategyId" TEXT,
    "signalId" TEXT,
    "allocationId" TEXT,
    "orderLinkId" TEXT,
    "entryTimestamp" TIMESTAMPTZ,
    "entryPrice" NUMERIC(38, 18),
    "entryFee" NUMERIC(38, 18),
    "entryReason" TEXT,
    "exitTimestamp" TIMESTAMPTZ,
    "exitPrice" NUMERIC(38, 18),
    "exitFee" NUMERIC(38, 18),
    "exitReason" TEXT,
    "positionSize" NUMERIC(38, 18),
    leverage NUMERIC(20, 4),
    "realizedPnl" NUMERIC(38, 18),
    "realizedPnlPct" NUMERIC(20, 8),
    "maxFavorableExcursion" NUMERIC(38, 18),
    "maxAdverseExcursion" NUMERIC(38, 18),
    "stopLoss" NUMERIC(38, 18),
    "takeProfit" NUMERIC(38, 18),
    "trailingStop" NUMERIC(38, 18),
    "riskScore" NUMERIC(10, 6),
    "confirmationAttempts" INTEGER,
    "latencyMs" INTEGER,
    status trade_status NOT NULL DEFAULT 'open',
    extra JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_trades_session ON session_trades(session_id);
CREATE INDEX IF NOT EXISTS idx_session_trades_pair_time ON session_trades(pair, timeframe);
CREATE INDEX IF NOT EXISTS idx_session_trades_signal ON session_trades("signalId");

CREATE TABLE IF NOT EXISTS session_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES trading_sessions(id) ON DELETE CASCADE,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "totalPnl" NUMERIC(38, 18) DEFAULT 0,
    "realizedPnl" NUMERIC(38, 18) DEFAULT 0,
    "unrealizedPnl" NUMERIC(38, 18) DEFAULT 0,
    "totalReturnPct" NUMERIC(20, 8) DEFAULT 0,
    "winRatePct" NUMERIC(20, 8) DEFAULT 0,
    "profitFactor" NUMERIC(20, 8) DEFAULT 0,
    "avgTradePnl" NUMERIC(38, 18) DEFAULT 0,
    "avgWinPnl" NUMERIC(38, 18) DEFAULT 0,
    "avgLossPnl" NUMERIC(38, 18) DEFAULT 0,
    "sharpeRatio" NUMERIC(20, 8) DEFAULT 0,
    "sortinoRatio" NUMERIC(20, 8) DEFAULT 0,
    "maxDrawdownPct" NUMERIC(20, 8) DEFAULT 0,
    "maxDrawdownAmount" NUMERIC(38, 18) DEFAULT 0,
    "expectancy" NUMERIC(38, 18) DEFAULT 0,
    "tradeCount" INTEGER DEFAULT 0,
    "winningTrades" INTEGER DEFAULT 0,
    "losingTrades" INTEGER DEFAULT 0,
    "openPositions" INTEGER DEFAULT 0,
    "closedPositions" INTEGER DEFAULT 0,
    "avgConcurrentTrades" NUMERIC(20, 8) DEFAULT 0,
    "peakConcurrentTrades" INTEGER DEFAULT 0,
    "latencyMsAvg" NUMERIC(20, 8) DEFAULT 0,
    "latencyMsP95" NUMERIC(20, 8) DEFAULT 0,
    metadata JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_metrics_session ON session_metrics(session_id);


-- Обновление временных меток (функция и триггеры закомментированы для упрощения)
-- CREATE OR REPLACE FUNCTION update_updated_at_column()
-- RETURNS TRIGGER AS $$
-- BEGIN
--     NEW.updated_at = CURRENT_TIMESTAMP;
--     RETURN NEW;
-- END;
-- $$ language 'plpgsql';

-- Триггеры для автообновления updated_at (отключены)
-- CREATE TRIGGER update_trading_pairs_updated_at BEFORE UPDATE ON trading_pairs 
--     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
-- CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings 
--     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

