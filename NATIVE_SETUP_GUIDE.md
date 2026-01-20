# 🚀 **Backtester v2 - Нативная установка (без Docker)**

## 📋 **Обзор**

Это руководство поможет вам запустить Backtester v2 в нативном режиме на Windows без использования Docker. Система состоит из 5 компонентов:

- **Backend** - Node.js/TypeScript API (порт 5000)
- **Frontend** - Vue 3 интерфейс (порт 5173)
- **GPU Service** - Сервис GPU вычислений (порт 6000)  
- **PostgreSQL** - База данных (порт 5432)
- **Redis** - Кеш и очереди (порт 6379)

---

## 🔧 **Системные требования**

### Обязательные:
- **Windows 10/11**
- **Node.js 18+** ([скачать](https://nodejs.org/))
- **npm 8+** (идет с Node.js)
- **PostgreSQL 13+** ([скачать](https://www.postgresql.org/download/windows/))
- **Redis** (устанавливается через Chocolatey)
- **Git** для клонирования репозитория

### Рекомендуемые:
- **8+ GB RAM** (для больших портфолио)
- **NVIDIA GPU** с CUDA (для GPU ускорения)
- **PowerShell 5.1+** (встроен в Windows)

### Аппаратные ресурсы (как в Docker):
- **CPU**: 3 ядра (Ryzen 5 8400F или аналог)
- **RAM**: 6-10 GB
- **GPU**: RTX 4060 или лучше
- **Диск**: 150-200 GB свободного места

---

## 🚀 **Быстрый старт**

### 1️⃣ **Подготовка системы**
```powershell
# Клонируйте репозиторий
git clone <your-repo-url> backtesterv2
cd backtesterv2

# Запустите установку зависимостей (от администратора)
npm run setup
```

### 2️⃣ **Настройка баз данных** 
```powershell
# Настройте PostgreSQL и Redis
npm run setup:db
```

### 3️⃣ **Создание конфигураций**
```powershell
# Создайте .env файлы
npm run setup:env
```

### 4️⃣ **Запуск всего приложения**
```powershell
# Запустите все сервисы
npm start
```

**Готово!** Приложение будет доступно на http://localhost:5173

---

## 📖 **Подробная инструкция**

### **Шаг 1: Установка зависимостей**

#### Автоматическая установка:
```powershell
# Запустить от имени администратора
npm run setup
```

#### Ручная установка:

1. **Node.js и npm**:
   - Скачайте с https://nodejs.org/ (выберите LTS версию 18+)
   - Установите с настройками по умолчанию
   - Проверьте: `node --version` и `npm --version`

2. **PostgreSQL**:
   - Скачайте с https://www.postgresql.org/download/windows/
   - При установке запомните пароль для пользователя `postgres`
   - Убедитесь, что PostgreSQL добавлен в PATH

3. **Redis**:
   ```powershell
   # Установите Chocolatey если нет
   Set-ExecutionPolicy Bypass -Scope Process -Force
   iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
   
   # Установите Redis
   choco install redis-64 -y
   ```

### **Шаг 2: Настройка баз данных**

#### Автоматическая настройка:
```powershell
npm run setup:db
```

#### Ручная настройка PostgreSQL:
```sql
-- Подключитесь как postgres
psql -U postgres

-- Создайте пользователя и базу
CREATE USER "user" WITH PASSWORD 'password';
ALTER USER "user" CREATEDB;
CREATE DATABASE "backtester" OWNER "user";
GRANT ALL PRIVILEGES ON DATABASE "backtester" TO "user";
```

#### Запуск Redis:
```powershell
redis-server
```

### **Шаг 3: Конфигурация проекта**

#### Создание .env файлов:
```powershell
npm run setup:env
```

Это создаст:
- `backend/.env` - настройки бэкенда
- `frontend/.env` - настройки фронтенда  
- `gpu-service/.env` - настройки GPU сервиса

#### Настройка API ключей OKX (опционально):
Отредактируйте `backend/.env`:
```env
OKX_API_KEY=your_api_key_here
OKX_API_SECRET=your_secret_here  
OKX_API_PASSPHRASE=your_passphrase_here
```

### **Шаг 4: Установка зависимостей проекта**
```powershell
# Backend
cd backend
npm install
npm run build
cd ..

# Frontend  
cd frontend
npm install
cd ..

# GPU Service
cd gpu-service
npm install
npm run build
cd ..
```

---

## 🎮 **Способы запуска**

### **🚀 Все сервисы сразу** (рекомендуется)
```powershell
npm start
```
Откроет 3 окна PowerShell для каждого сервиса.

### **⚙️ Отдельные компоненты**

#### Backend только:
```powershell
npm run start:backend
```

#### Frontend только:
```powershell
npm run start:frontend
```

#### GPU Service только:
```powershell
npm run start:gpu
```

### **⏹️ Остановка всех сервисов**
```powershell
npm stop
```

---

## 🌐 **URL адреса**

После запуска все сервисы будут доступны:

| Сервис | URL | Описание |
|--------|-----|----------|
| **Frontend** | http://localhost:5173 | Веб-интерфейс |
| **Backend API** | http://localhost:5000 | REST API |
| **GPU Service** | http://localhost:6000 | GPU вычисления |
| **PostgreSQL** | localhost:5432 | База данных |
| **Redis** | localhost:6379 | Кеш и очереди |

---

## 🔧 **Настройка производительности**

### **Память и CPU (в .env файлах):**

**Backend (`backend/.env`)**:
```env
NODE_OPTIONS=--max-old-space-size=8192 --expose-gc --max-semi-space-size=1024
UV_THREADPOOL_SIZE=8
ENABLE_LARGE_PORTFOLIO_MODE=true
```

**GPU Service (`gpu-service/.env`)**:
```env
NODE_OPTIONS=--max-old-space-size=2048
CUDA_VISIBLE_DEVICES=0
```

### **PostgreSQL** (настройка в postgresql.conf):
```ini
shared_buffers = 1GB
work_mem = 16MB  
maintenance_work_mem = 256MB
effective_cache_size = 2GB
```

---

## 🛠️ **Диагностика проблем**

### **Проверка состояния системы:**
```powershell
# Проверка портов
netstat -an | findstr "5000 5173 6000 5432 6379"

# Проверка процессов
tasklist | findstr "node.exe postgres.exe redis-server.exe"

# Проверка баз данных
psql -h localhost -U user -d backtester -c "SELECT version();"
redis-cli ping
```

### **Логи и отладка:**
- Backend логи: `backend/logs/`
- Консоль каждого сервиса в отдельном окне PowerShell
- Логи PostgreSQL: `C:\\Program Files\\PostgreSQL\\XX\\data\\log\\`

### **Частые проблемы:**

**1. Порт уже занят:**
```powershell
# Найти и завершить процесс
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

**2. PostgreSQL не доступен:**
```powershell
# Проверка сервиса
Get-Service postgresql*
# Запуск сервиса
Start-Service postgresql-x64-13
```

**3. Redis не запускается:**
```powershell
# Запуск в отдельном окне
Start-Process redis-server
```

**4. Ошибки компиляции TypeScript:**
```powershell
# Очистка и переустановка
cd backend
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## 📊 **Мониторинг производительности**

### **Мониторинг системных ресурсов:**
```powershell
# CPU и память
Get-Counter "\\Processor(_Total)\\% Processor Time" -Continuous
Get-Counter "\\Memory\\Available MBytes" -Continuous

# Процессы Node.js
Get-Process node | Select-Object Name,CPU,WS
```

### **Мониторинг GPU (если доступно):**
```powershell
nvidia-smi -l 5  # Обновление каждые 5 секунд
```

### **Мониторинг баз данных:**
```sql
-- PostgreSQL активность
SELECT * FROM pg_stat_activity WHERE state = 'active';

-- Размер базы данных
SELECT pg_size_pretty(pg_database_size('backtester'));
```

```bash
# Redis статистика
redis-cli info memory
redis-cli info stats
```

---

## 🔄 **Обновление системы**

### **Обновление кода:**
```powershell
git pull origin main
npm run build
```

### **Обновление зависимостей:**
```powershell
# Backend
cd backend && npm update && npm run build && cd ..

# Frontend
cd frontend && npm update && cd ..

# GPU Service  
cd gpu-service && npm update && npm run build && cd ..
```

### **Миграции базы данных:**
```powershell
cd backend
npm run migration:run
```

---

## ⚡ **Оптимизация для продакшн**

### **1. Сборка для продакшн:**
```powershell
# Установить NODE_ENV=production в .env файлах
npm run build

# Использовать npm start вместо npm run dev для каждого сервиса
```

### **2. Настройка автозапуска (PM2):**
```powershell
npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

### **3. Настройка reverse proxy (nginx):**
Установите nginx и настройте проксирование для продакшн использования.

---

## 📞 **Поддержка**

### **При возникновении проблем:**
1. Проверьте логи в консольных окнах сервисов
2. Убедитесь, что все порты свободны
3. Проверьте, что PostgreSQL и Redis запущены
4. Перезапустите проблемный сервис отдельно

### **Полезные команды:**
```powershell
# Полный перезапуск системы
npm stop
npm start

# Проверка всех компонентов
npm test
```

---

**🎉 Готово! Теперь у вас есть полнофункциональная система бэктестинга, работающая без Docker!**

