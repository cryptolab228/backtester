# Локальная разработка Backtester V2 без Docker

## 🎯 Обзор

Этот документ содержит полные инструкции по настройке и запуску проекта Backtester V2 в локальном окружении без использования Docker. Локальная разработка предоставляет преимущества в скорости, отладке и гибкости разработки.

## 📋 Предварительные требования

### Системные зависимости
- **Node.js** 18+ (LTS версия рекомендуется)
- **npm** 8+
- **PostgreSQL** 14+
- **Redis** 6+
- **TimescaleDB** расширение для PostgreSQL
- **Git** (для управления версиями)

### Рекомендуемые инструменты
- **VS Code** с расширениями для TypeScript/Vue
- **DBeaver** или **pgAdmin** для работы с базой данных
- **Redis Desktop Manager** для мониторинга Redis

## 🚀 Быстрый старт

### 1. Автоматическая настройка (рекомендуется)

```bash
# Клонирование репозитория (если еще не сделано)
git clone <repository-url>
cd backtesterv2

# Автоматическая настройка всего окружения
./scripts/setup-local-environment.sh

# Проверка готовности окружения
./scripts/check-local-environment.sh

# Запуск приложения
./scripts/start-local.sh
```

### 2. Ручная настройка (для продвинутых пользователей)

#### Установка зависимостей Ubuntu/Debian:
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# TimescaleDB
sudo add-apt-repository ppa:timescale/timescaledb-ppa
sudo apt update
sudo apt install timescaledb-2-postgresql-14

# Redis
sudo apt install redis-server

# Запуск сервисов
sudo systemctl start postgresql redis-server
sudo systemctl enable postgresql redis-server
```

#### Установка зависимостей macOS:
```bash
# Homebrew (если не установлен)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Зависимости
brew install node postgresql redis
brew tap timescale/tap
brew install timescaledb

# Запуск сервисов
brew services start postgresql redis
```

#### Настройка базы данных:
```bash
# Создание пользователя и базы данных
sudo -u postgres psql
CREATE DATABASE backtester_db;
CREATE USER "user" WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE backtester_db TO "user";
ALTER USER "user" CREATEDB;
\q

# Активация TimescaleDB
sudo -u postgres psql -d backtester_db
CREATE EXTENSION IF NOT EXISTS timescaledb;
\q
```

#### Настройка проекта:
```bash
# Установка зависимостей
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Копирование конфигурационных файлов
cp backend/.env.local backend/.env
cp frontend/.env.local frontend/.env

# Создание необходимых директорий
mkdir -p backend/logs backend/public/portfolio-results
```

## 🛠️ Инструменты разработки

### Основные команды

```bash
# Универсальный инструмент разработки
./scripts/dev-tools.sh [команда]

# Доступные команды:
./scripts/dev-tools.sh check      # Проверить окружение
./scripts/dev-tools.sh start      # Запустить сервисы
./scripts/dev-tools.sh stop       # Остановить сервисы
./scripts/dev-tools.sh restart    # Перезапустить сервисы
./scripts/dev-tools.sh reset      # Сбросить данные
./scripts/dev-tools.sh logs       # Показать логи
./scripts/dev-tools.sh db         # Подключиться к БД
./scripts/dev-tools.sh redis      # Подключиться к Redis
./scripts/dev-tools.sh test       # Запустить тесты
./scripts/dev-tools.sh help       # Показать справку
```

### Индивидуальные скрипты

```bash
# Настройка окружения
./scripts/setup-local-environment.sh

# Проверка состояния
./scripts/check-local-environment.sh

# Запуск/остановка
./scripts/start-local.sh
./scripts/stop-local.sh

# Сброс данных
./scripts/reset-local-data.sh
```

### Ручной запуск компонентов

```bash
# Backend (в отдельном терминале)
cd backend
npm run dev:local

# Frontend (в отдельном терминале)
cd frontend
npm run dev:local
```

## 🌐 Доступ к приложению

После успешного запуска сервисы будут доступны по адресам:

- **🌐 Frontend**: http://localhost:5173
- **🔌 Backend API**: http://localhost:5000
- **🗄️ PostgreSQL**: localhost:5432 (база: `backtester_db`, пользователь: `user`)
- **📦 Redis**: localhost:6379

## 🔧 Конфигурация

### Backend (.env)
```env
NODE_ENV=development
PORT=5000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=user
DB_PASSWORD=password
DB_DATABASE=backtester_db

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# API Keys (заполните при необходимости)
OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=
BYBIT_API_KEY=
BYBIT_API_SECRET=
```

### Frontend (.env)
```env
VITE_API_BASE_URL=http://localhost:5000
VITE_WS_URL=ws://localhost:5000
VITE_NODE_ENV=development
```

## 🧪 Тестирование

```bash
# Backend тесты
cd backend
npm run test:local

# Проверка типов Frontend
cd frontend
npm run build:local
```

## 🔍 Отладка

### Проблемы с подключением к базе данных

```bash
# Проверка статуса PostgreSQL
pg_isready -h localhost -p 5432

# Прямое подключение
psql -h localhost -U user -d backtester_db

# Проверка TimescaleDB
psql -h localhost -U user -d backtester_db -c "SELECT * FROM pg_extension WHERE extname='timescaledb';"
```

### Проблемы с Redis

```bash
# Проверка Redis
redis-cli ping

# Мониторинг команд
redis-cli monitor

# Просмотр ключей
redis-cli keys "*"
```

### Проблемы с портами

```bash
# Проверка занятых портов
lsof -i :5000  # Backend
lsof -i :5173  # Frontend
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis

# Принудительное освобождение порта
kill -9 $(lsof -ti:5000)
```

### Логи приложения

```bash
# Backend логи
tail -f backend/logs/*.log

# Frontend логи в консоли браузера
# Или в терминале где запущен Vite
```

## 📊 Мониторинг производительности

### Системные ресурсы

```bash
# Использование CPU/памяти Node.js процессами
ps aux | grep node

# Мониторинг PostgreSQL
SELECT * FROM pg_stat_activity;

# Мониторинг Redis
redis-cli info memory
redis-cli info stats
```

### Метрики приложения

- Backend логи содержат информацию о производительности API
- Frontend dev tools показывают время загрузки компонентов
- PostgreSQL логи содержат медленные запросы (если включены)

## 🔄 Переключение между режимами

### Возврат к Docker

```bash
# Остановка локальных сервисов
./scripts/stop-local.sh

# Запуск Docker версии
docker-compose -f docker-compose.yml -f docker-compose.override.yml up --build
```

### Гибридный режим

Можно использовать Docker только для баз данных:

```bash
# Запуск только PostgreSQL и Redis в Docker
docker-compose up db redis -d

# Обновление конфигурации для подключения к Docker БД
# В backend/.env изменить:
# DB_HOST=localhost  # Docker проброшен на localhost:5432
# REDIS_HOST=localhost  # Docker проброшен на localhost:6379

# Запуск приложения локально
./scripts/start-local.sh
```

## 📈 Оптимизация разработки

### VS Code настройки

Рекомендуемые расширения:
- TypeScript Vue Plugin (Volar)
- ESLint
- Prettier
- GitLens
- Thunder Client (для тестирования API)

### Полезные сниппеты

```json
// .vscode/settings.json
{
  "typescript.preferences.importModuleSpecifier": "relative",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

### Hot Reloading

- **Backend**: Автоматический перезапуск при изменении файлов (ts-node-dev)
- **Frontend**: Мгновенное обновление в браузере (Vite HMR)
- **База данных**: Автоматическая синхронизация схемы в dev режиме

## 🚨 Устранение неполадок

### Частые проблемы

1. **"PostgreSQL connection refused"**
   ```bash
   sudo systemctl start postgresql
   # или для macOS
   brew services start postgresql
   ```

2. **"Redis connection refused"**
   ```bash
   sudo systemctl start redis-server
   # или для macOS
   brew services start redis
   ```

3. **"Permission denied" при создании директорий**
   ```bash
   sudo chown -R $USER:$USER backend/logs backend/public
   ```

4. **"Port already in use"**
   ```bash
   ./scripts/stop-local.sh
   # или принудительно
   kill -9 $(lsof -ti:5000)
   ```

5. **Проблемы с зависимостями Node.js**
   ```bash
   ./scripts/dev-tools.sh install
   ```

### Получение помощи

1. Проверьте логи: `./scripts/dev-tools.sh logs`
2. Проверьте окружение: `./scripts/dev-tools.sh check`
3. Сбросьте данные: `./scripts/dev-tools.sh reset`
4. Переустановите зависимости: `./scripts/dev-tools.sh install`

## 🎉 Преимущества локальной разработки

### ✅ Преимущества:
- **Быстрая разработка**: Нет накладных расходов контейнеризации
- **Простая отладка**: Прямой доступ к процессам и файлам
- **IDE интеграция**: Лучшая поддержка отладчиков и инструментов
- **Гибкость**: Легкое переключение между версиями Node.js
- **Производительность**: Нативное выполнение без виртуализации
- **Быстрые тесты**: Мгновенный запуск тестов без сборки образов

### ⚠️ Недостатки:
- **Зависимости ОС**: Требует установки PostgreSQL, Redis локально
- **Консистентность**: Различия в окружениях разработчиков
- **Настройка**: Больше шагов первоначальной настройки

## 📝 Следующие шаги

1. ✅ Настройте локальное окружение: `./scripts/setup-local-environment.sh`
2. ✅ Проверьте готовность: `./scripts/check-local-environment.sh`
3. ✅ Запустите приложение: `./scripts/start-local.sh`
4. 🌐 Откройте http://localhost:5173 и начните разработку!
5. 📖 Изучите API документацию на http://localhost:5000
6. 🧪 Запустите тесты для проверки функциональности

---

**Готово к разработке!** 🚀