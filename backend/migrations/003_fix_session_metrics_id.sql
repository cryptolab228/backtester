-- Миграция: Добавление DEFAULT для id в session_metrics
-- Дата: 2025-10-17
-- Причина: TypeORM ожидает автогенерацию UUID для PRIMARY KEY

-- Проверяем версию PostgreSQL и добавляем DEFAULT для id
DO $$
BEGIN
    -- Проверяем, есть ли уже DEFAULT
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'session_metrics' 
        AND column_name = 'id' 
        AND column_default IS NOT NULL
    ) THEN
        -- Добавляем DEFAULT для автогенерации UUID
        IF (SELECT split_part(version(), ' ', 2)::numeric) >= 13 THEN
            -- PostgreSQL 13+ - используем встроенную gen_random_uuid()
            ALTER TABLE session_metrics 
            ALTER COLUMN id SET DEFAULT gen_random_uuid();
            
            RAISE NOTICE '✓ Added gen_random_uuid() default to session_metrics.id';
        ELSE
            -- PostgreSQL < 13 - используем uuid-ossp расширение
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
            
            ALTER TABLE session_metrics 
            ALTER COLUMN id SET DEFAULT uuid_generate_v4();
            
            RAISE NOTICE '✓ Added uuid_generate_v4() default to session_metrics.id';
        END IF;
    ELSE
        RAISE NOTICE '✓ DEFAULT already exists for session_metrics.id';
    END IF;
END $$;

-- Проверка результата
SELECT 
    column_name, 
    column_default,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'session_metrics' 
  AND column_name = 'id';





