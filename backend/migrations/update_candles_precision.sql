-- Миграция для увеличения точности полей в таблице candles
-- Устраняет ошибку "numeric field overflow" для мем-токенов и больших объемов

BEGIN;

-- Обновляем поля цен: precision 18,8 -> 28,18 для поддержки мем-токенов
ALTER TABLE candles 
  ALTER COLUMN open TYPE DECIMAL(28,18),
  ALTER COLUMN high TYPE DECIMAL(28,18),
  ALTER COLUMN low TYPE DECIMAL(28,18),
  ALTER COLUMN close TYPE DECIMAL(28,18);

-- Обновляем поля объемов: precision 18,8 -> 30,8 для поддержки больших объемов
ALTER TABLE candles 
  ALTER COLUMN volume TYPE DECIMAL(30,8),
  ALTER COLUMN volume_quote TYPE DECIMAL(30,8);

-- Добавляем комментарий к таблице
COMMENT ON TABLE candles IS 'Исторические свечи с увеличенной точностью для мем-токенов и больших объемов';

COMMIT; 