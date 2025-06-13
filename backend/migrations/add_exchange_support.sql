-- Миграция для добавления поддержки мультибиржевости
-- Добавляет поле exchange в таблицу trading_pairs

BEGIN;

-- Добавляем поле exchange со значением по умолчанию 'okx' для существующих записей
ALTER TABLE trading_pairs 
ADD COLUMN exchange VARCHAR(20) DEFAULT 'okx' NOT NULL;

-- Обновляем все существующие записи со значением 'okx' 
UPDATE trading_pairs SET exchange = 'okx' WHERE exchange IS NULL;

-- Удаляем старый уникальный индекс по одному полю symbol
DROP INDEX IF EXISTS idx_trading_pairs_symbol;

-- Создаем новый составной уникальный индекс по symbol + exchange
CREATE UNIQUE INDEX idx_trading_pairs_symbol_exchange ON trading_pairs(symbol, exchange);

-- Добавляем комментарий к таблице
COMMENT ON TABLE trading_pairs IS 'Торговые пары с поддержкой множественных бирж';
COMMENT ON COLUMN trading_pairs.exchange IS 'Биржа: okx или bybit';

-- Добавляем ограничение на возможные значения exchange
ALTER TABLE trading_pairs 
ADD CONSTRAINT check_exchange_values 
CHECK (exchange IN ('okx', 'bybit'));

COMMIT; 