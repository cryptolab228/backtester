# 🔴 FIX: Ошибка "значение NULL в столбце id"

## ПРОБЛЕМА

```
error: значение NULL в столбце "id" отношения "trading_sessions" нарушает ограничение NOT NULL
```

## ПРИЧИНА

**Расхождение между TypeORM моделью и SQL схемой:**

### TypeORM модель (`TradingSession.ts`):
```typescript
@PrimaryGeneratedColumn('uuid')
id!: string;
```
Ожидает, что UUID будет генерироваться **автоматически**.

### SQL схема (`createTables.sql`):
```sql
id UUID PRIMARY KEY,
```
❌ **НЕТ DEFAULT значения!** PostgreSQL не знает, как генерировать UUID.

---

## РЕШЕНИЕ

### Вариант 1: Исправить SQL схему (РЕКОМЕНДУЕТСЯ)

Обновите `backend/src/sql/createTables.sql`:

```sql
-- БЫЛО:
id UUID PRIMARY KEY,

-- СТАЛО:
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
```

Затем пересоздайте таблицу или выполните миграцию:

```sql
ALTER TABLE trading_sessions 
ALTER COLUMN id SET DEFAULT gen_random_uuid();
```

### Вариант 2: Использовать расширение uuid-ossp (для старых PostgreSQL)

Если `gen_random_uuid()` не работает:

```sql
-- Включить расширение
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Обновить таблицу
ALTER TABLE trading_sessions 
ALTER COLUMN id SET DEFAULT uuid_generate_v4();
```

---

## БЫСТРОЕ ИСПРАВЛЕНИЕ (SQL команда)

```sql
-- Подключитесь к вашей базе данных и выполните:
ALTER TABLE trading_sessions 
ALTER COLUMN id SET DEFAULT gen_random_uuid();
```

---

## ПРОВЕРКА

После исправления проверьте:

```sql
-- Должен вернуть что-то вроде: nextval('..._seq') или gen_random_uuid()
SELECT column_default 
FROM information_schema.columns 
WHERE table_name = 'trading_sessions' 
  AND column_name = 'id';
```

Должно вернуть: `gen_random_uuid()`

---

## ВРЕМЕННОЕ РЕШЕНИЕ (в коде)

Если не можете изменить БД прямо сейчас, можно явно генерировать UUID в коде:

```typescript
// В BacktestSessionService или где создается TradingSession:
import { v4 as uuidv4 } from 'uuid';

const session = new TradingSession();
session.id = uuidv4();  // ← Явная генерация UUID
// ... остальные поля
await sessionRepository.save(session);
```

НО это **не рекомендуется** - лучше исправить схему БД!



