-- Добавляем индексы для оптимизации производительности таблицы trading_pairs

-- Индекс для оптимизации сортировки по exchange и symbol
CREATE INDEX IF NOT EXISTS "IDX_trading_pairs_exchange_symbol" ON "trading_pairs" ("exchange", "symbol");

-- Индекс для быстрого поиска по символу
CREATE INDEX IF NOT EXISTS "IDX_trading_pairs_symbol" ON "trading_pairs" ("symbol");

-- Индекс для фильтрации по бирже
CREATE INDEX IF NOT EXISTS "IDX_trading_pairs_exchange" ON "trading_pairs" ("exchange");

-- Показываем информацию о созданных индексах
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'trading_pairs'
ORDER BY indexname; 