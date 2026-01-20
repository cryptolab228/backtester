-- 🚀 Backtester V2 - Настройка базы данных
-- Этот скрипт создает базу данных, пользователей и таблицы

-- ==============================================================================
-- ЧАСТЬ 1: СОЗДАНИЕ БАЗЫ ДАННЫХ И ПОЛЬЗОВАТЕЛЕЙ
-- Выполняется под пользователем postgres
-- ==============================================================================

-- Создание базы данных
CREATE DATABASE backtester
    WITH 
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'Russian_Russia.1251'
    LC_CTYPE = 'Russian_Russia.1251'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1;

-- Создание пользователя для приложения (опционально)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'backtester_user') THEN
        CREATE USER backtester_user WITH PASSWORD 'postgres123';
    END IF;
END
$$;

-- Предоставление прав пользователю
GRANT ALL PRIVILEGES ON DATABASE backtester TO backtester_user;
GRANT ALL PRIVILEGES ON DATABASE backtester TO postgres;

-- Комментарий к базе данных
COMMENT ON DATABASE backtester IS 'База данных для системы бэктестинга торговых стратегий v2';

\echo '✅ База данных и пользователи созданы'

-- ==============================================================================
-- ЧАСТЬ 2: СОЗДАНИЕ ТАБЛИЦ И ИНДЕКСОВ
-- Подключение к базе данных backtester
-- ==============================================================================

\c backtester

-- Создание схемы public если не существует
CREATE SCHEMA IF NOT EXISTS public;

-- Предоставление прав на схему
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO backtester_user;
GRANT ALL ON SCHEMA public TO public;

-- Подключаем основной скрипт схемы
\i backend/src/sql/createTables.sql

-- ==============================================================================
-- ПРЕДОСТАВЛЕНИЕ ПРАВ ПОЛЬЗОВАТЕЛЯМ
-- ==============================================================================

-- Права для postgres
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Права для backtester_user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO backtester_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO backtester_user;

-- Права для будущих таблиц
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO backtester_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO backtester_user;

\echo '✅ Права пользователей настроены'

-- ==============================================================================
-- ВСТАВКА ТЕСТОВЫХ ДАННЫХ (опционально)
-- ==============================================================================

-- Базовые настройки приложения
INSERT INTO settings (key, value, description, category) VALUES
    ('app_version', '2.0.0', 'Версия приложения', 'general'),
    ('default_timeframe', '1h', 'Таймфрейм по умолчанию для бэктестинга', 'backtesting'),
    ('max_concurrent_jobs', '10', 'Максимальное количество одновременных задач', 'performance'),
    ('enable_gpu_acceleration', 'false', 'Включить GPU ускорение', 'performance')
ON CONFLICT (key) DO NOTHING;

\echo '✅ Базовые настройки добавлены'

-- ==============================================================================
-- СТАТИСТИКА ПО СОЗДАННЫМ ОБЪЕКТАМ
-- ==============================================================================

\echo ''
\echo '📊 СОЗДАНО ОБЪЕКТОВ:'

-- Подсчет таблиц
SELECT 
    'Таблицы' as object_type,
    COUNT(*) as count
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- Подсчет индексов
SELECT 
    'Индексы' as object_type,
    COUNT(*) as count
FROM pg_indexes 
WHERE schemaname = 'public';

-- Список созданных таблиц
\echo ''
\echo '📋 СОЗДАННЫЕ ТАБЛИЦЫ:'
SELECT 
    table_name,
    table_comment
FROM information_schema.tables t
LEFT JOIN (
    SELECT 
        pgc.relname as table_name,
        pgd.description as table_comment
    FROM pg_class pgc
    JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace
    LEFT JOIN pg_description pgd ON pgd.objoid = pgc.oid AND pgd.objsubid = 0
    WHERE pgn.nspname = 'public' AND pgc.relkind = 'r'
) tc ON tc.table_name = t.table_name
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name;

-- Список созданных индексов
\echo ''
\echo '🔍 СОЗДАННЫЕ ИНДЕКСЫ:'
SELECT 
    schemaname,
    tablename,
    indexname,
    CASE 
        WHEN indexname LIKE '%unique%' OR indexname LIKE '%_pkey' THEN 'UNIQUE'
        ELSE 'INDEX'
    END as index_type
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

\echo ''
\echo '🎉 БАЗА ДАННЫХ УСПЕШНО НАСТРОЕНА!'
\echo '🔗 Подключение: postgresql://postgres:postgres123@localhost:5432/backtester'
\echo '👤 Пользователи: postgres, backtester_user'
\echo '📁 Схема: public'

