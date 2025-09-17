# План адаптации проекта для локальной разработки без Docker

## Анализ текущего состояния проекта

### Архитектура проекта
- **Backend**: Node.js + TypeScript + Express.js
- **Frontend**: Vue.js 3 + TypeScript + Vite
- **База данных**: PostgreSQL (TimescaleDB)
- **Кэш/Очереди**: Redis
- **Контейнеризация**: Docker + Docker Compose

### Зависимости от Docker
1. PostgreSQL (TimescaleDB) - контейнер `backtester-db`
2. Redis - контейнер `backtester-redis`
3. Сетевое взаимодействие между сервисами
4. Переменные окружения и конфигурация

## План адаптации

### Этап 1: Настройка локальных баз данных

#### 1.1 PostgreSQL
**Задача**: Установить и настроить локальный PostgreSQL с TimescaleDB

**Шаги**:
1. Установить PostgreSQL локально
2. Установить расширение TimescaleDB
3. Создать базу данных `backtester_db`
4. Создать пользователя `user` с паролем `password`
5. Настроить права доступа

**Команды для установки**:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

# TimescaleDB
sudo add-apt-repository ppa:timescale/timescaledb-ppa
sudo apt update
sudo apt install timescaledb-2-postgresql-14

# Настройка базы данных
sudo -u postgres psql
CREATE DATABASE backtester_db;
CREATE USER "user" WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE backtester_db TO "user";
\q

# Активация TimescaleDB
sudo -u postgres psql -d backtester_db
CREATE EXTENSION IF NOT EXISTS timescaledb;
\q
```

#### 1.2 Redis
**Задача**: Установить и настроить локальный Redis

**Команды для установки**:
```bash
# Ubuntu/Debian
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Проверка работы
redis-cli ping
# Должен вернуть PONG
```

### Этап 2: Адаптация конфигурации Backend

#### 2.1 Переменные окружения
**Файл**: `backend/.env`
```env
NODE_ENV=development
PORT=5000

# PostgreSQL Database (локальные настройки)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=user
DB_PASSWORD=password
DB_DATABASE=backtester_db

# Redis (локальные настройки)
REDIS_HOST=localhost
REDIS_PORT=6379

# API Keys (заполнить при необходимости)
OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=

BYBIT_API_KEY=
BYBIT_API_SECRET=
BYBIT_API_URL=https://api.bybit.com
```

#### 2.2 Конфигурация TypeScript
**Обновления не требуются** - текущая конфигурация совместима с локальной разработкой.

#### 2.3 Скрипты package.json
**Файл**: `backend/package.json`
Добавить новые скрипты:
```json
{
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/app.js",
    "dev": "ts-node-dev -r tsconfig-paths/register --respawn --transpile-only --ignore-watch node_modules --no-notify src/app.ts",
    "dev:local": "NODE_ENV=development ts-node-dev -r tsconfig-paths/register --respawn --transpile-only --ignore-watch node_modules --no-notify src/app.ts",
    "test": "jest",
    "migrate": "node -r ts-node/register -r tsconfig-paths/register src/utils/migrate.ts"
  }
}
```

### Этап 3: Адаптация конфигурации Frontend

#### 3.1 Vite конфигурация
**Файл**: `frontend/vite.config.ts`
```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000', // Изменено с backend:5000 на localhost:5000
        changeOrigin: true,
      }
    }
  }
})
```

#### 3.2 Переменные окружения
**Файл**: `frontend/.env.development`
```env
VITE_API_BASE_URL=http://localhost:5000
```

### Этап 4: Создание скриптов управления

#### 4.1 Скрипт запуска всех сервисов
**Файл**: `scripts/start-local.sh`
```bash
#!/bin/bash

echo "🚀 Запуск Backtester V2 в локальном режиме..."

# Проверка PostgreSQL
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo "❌ PostgreSQL не запущен. Запустите: sudo systemctl start postgresql"
    exit 1
fi

# Проверка Redis
if ! redis-cli ping > /dev/null 2>&1; then
    echo "❌ Redis не запущен. Запустите: sudo systemctl start redis-server"
    exit 1
fi

echo "✅ Базы данных готовы"

# Установка зависимостей
echo "📦 Установка зависимостей..."
cd backend && npm install
cd ../frontend && npm install
cd ..

# Создание директорий
mkdir -p backend/logs
mkdir -p backend/public/portfolio-results

echo "🔧 Запуск Backend..."
cd backend
npm run dev:local &
BACKEND_PID=$!
cd ..

echo "🎨 Запуск Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo "✅ Сервисы запущены:"
echo "   - Backend: http://localhost:5000"
echo "   - Frontend: http://localhost:5173"
echo "   - PostgreSQL: localhost:5432"
echo "   - Redis: localhost:6379"

# Функция для остановки процессов
cleanup() {
    echo "🛑 Остановка сервисов..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

# Обработка сигналов
trap cleanup SIGINT SIGTERM

# Ожидание
wait
```

#### 4.2 Скрипт остановки
**Файл**: `scripts/stop-local.sh`
```bash
#!/bin/bash

echo "🛑 Остановка локальных сервисов..."

# Остановка Node.js процессов
pkill -f "ts-node-dev"
pkill -f "vite"

echo "✅ Сервисы остановлены"
```

#### 4.3 Скрипт настройки базы данных
**Файл**: `scripts/setup-database.sh`
```bash
#!/bin/bash

echo "🗄️ Настройка локальной базы данных..."

# Проверка PostgreSQL
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL не установлен"
    echo "Установите: sudo apt install postgresql postgresql-contrib"
    exit 1
fi

# Создание базы данных и пользователя
sudo -u postgres psql << EOF
-- Создание пользователя и базы данных
DROP DATABASE IF EXISTS backtester_db;
DROP USER IF EXISTS "user";

CREATE USER "user" WITH PASSWORD 'password';
CREATE DATABASE backtester_db OWNER "user";

-- Предоставление прав
GRANT ALL PRIVILEGES ON DATABASE backtester_db TO "user";

\q
EOF

# Активация TimescaleDB
sudo -u postgres psql -d backtester_db << EOF
CREATE EXTENSION IF NOT EXISTS timescaledb;
\q
EOF

echo "✅ База данных настроена"
echo "   - База: backtester_db"
echo "   - Пользователь: user"
echo "   - Пароль: password"
```

### Этап 5: Создание утилит для разработки

#### 5.1 Скрипт проверки окружения
**Файл**: `scripts/check-environment.sh`
```bash
#!/bin/bash

echo "🔍 Проверка локального окружения..."

# Проверка Node.js
if command -v node &> /dev/null; then
    echo "✅ Node.js: $(node --version)"
else
    echo "❌ Node.js не установлен"
fi

# Проверка npm
if command -v npm &> /dev/null; then
    echo "✅ npm: $(npm --version)"
else
    echo "❌ npm не установлен"
fi

# Проверка PostgreSQL
if command -v psql &> /dev/null; then
    echo "✅ PostgreSQL: $(psql --version | head -n1)"
    if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
        echo "✅ PostgreSQL сервер запущен"
    else
        echo "⚠️ PostgreSQL сервер не запущен"
    fi
else
    echo "❌ PostgreSQL не установлен"
fi

# Проверка Redis
if command -v redis-cli &> /dev/null; then
    echo "✅ Redis установлен"
    if redis-cli ping > /dev/null 2>&1; then
        echo "✅ Redis сервер запущен"
    else
        echo "⚠️ Redis сервер не запущен"
    fi
else
    echo "❌ Redis не установлен"
fi

# Проверка TimescaleDB
if sudo -u postgres psql -d backtester_db -c "SELECT * FROM pg_extension WHERE extname='timescaledb';" 2>/dev/null | grep -q timescaledb; then
    echo "✅ TimescaleDB активирован"
else
    echo "⚠️ TimescaleDB не активирован"
fi

echo ""
echo "📋 Следующие шаги для настройки:"
echo "1. Установите недостающие компоненты"
echo "2. Запустите: ./scripts/setup-database.sh"
echo "3. Запустите: ./scripts/start-local.sh"
```

#### 5.2 Скрипт сброса данных
**Файл**: `scripts/reset-data.sh`
```bash
#!/bin/bash

echo "🔄 Сброс данных разработки..."

# Очистка Redis
redis-cli FLUSHALL

# Очистка PostgreSQL
sudo -u postgres psql -d backtester_db << EOF
TRUNCATE TABLE candles CASCADE;
TRUNCATE TABLE trading_pairs CASCADE;
TRUNCATE TABLE settings CASCADE;
EOF

echo "✅ Данные сброшены"
```

### Этап 6: Обновление документации

#### 6.1 README для локальной разработки
**Файл**: `LOCAL_DEVELOPMENT.md`

```markdown
# Локальная разработка без Docker

## Предварительные требования

### Системные зависимости
- Node.js 18+ (LTS версия)
- npm 8+
- PostgreSQL 14+
- Redis 6+
- TimescaleDB расширение для PostgreSQL

## Быстрый старт

### 1. Установка системных зависимостей

#### Ubuntu/Debian:
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL + TimescaleDB
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo add-apt-repository ppa:timescale/timescaledb-ppa
sudo apt update
sudo apt install timescaledb-2-postgresql-14

# Redis
sudo apt install redis-server

# Запуск сервисов
sudo systemctl start postgresql redis-server
sudo systemctl enable postgresql redis-server
```

#### macOS:
```bash
# Homebrew
brew install node postgresql redis
brew services start postgresql redis

# TimescaleDB
brew tap timescale/tap
brew install timescaledb
```

### 2. Настройка проекта

```bash
# Клонирование репозитория
git clone <repository-url>
cd backtesterv2

# Проверка окружения
chmod +x scripts/*.sh
./scripts/check-environment.sh

# Настройка базы данных
./scripts/setup-database.sh

# Настройка переменных окружения
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Редактирование .env файлов при необходимости
```

### 3. Запуск приложения

```bash
# Запуск всех сервисов
./scripts/start-local.sh

# Или запуск по отдельности:
# Backend
cd backend && npm run dev:local

# Frontend (в новом терминале)
cd frontend && npm run dev
```

### 4. Доступ к приложению

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5000
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## Полезные команды

```bash
# Проверка состояния
./scripts/check-environment.sh

# Остановка сервисов
./scripts/stop-local.sh

# Сброс данных
./scripts/reset-data.sh

# Тестирование
cd backend && npm test
```

## Отладка

### Проблемы с подключением к БД
```bash
# Проверка PostgreSQL
pg_isready -h localhost -p 5432

# Подключение к БД
psql -h localhost -U user -d backtester_db

# Проверка TimescaleDB
psql -h localhost -U user -d backtester_db -c "SELECT * FROM pg_extension WHERE extname='timescaledb';"
```

### Проблемы с Redis
```bash
# Проверка Redis
redis-cli ping

# Мониторинг Redis
redis-cli monitor
```

### Логи приложения
- Backend логи: `backend/logs/`
- Frontend: консоль браузера и терминал Vite
```

## Преимущества локальной разработки

### ✅ Преимущества:
1. **Быстрая разработка**: Нет накладных расходов Docker
2. **Простая отладка**: Прямой доступ к процессам и логам
3. **IDE интеграция**: Лучшая поддержка отладчиков
4. **Гибкость**: Легкое переключение между версиями Node.js
5. **Производительность**: Нет виртуализации

### ⚠️ Недостатки:
1. **Зависимости ОС**: Требует установки PostgreSQL, Redis локально
2. **Консистентность**: Различия в окружениях разработчиков
3. **Настройка**: Больше шагов первоначальной настройки

## Миграция обратно в Docker

Для возврата к Docker-разработке:
```bash
# Остановка локальных сервисов
./scripts/stop-local.sh

# Запуск Docker
docker-compose -f docker-compose.yml -f docker-compose.override.yml up --build
```

## Следующие шаги

1. ✅ Создать план адаптации
2. 🔄 Реализовать скрипты настройки
3. 🔄 Обновить конфигурации
4. 🔄 Протестировать локальную разработку
5. 🔄 Обновить основную документацию