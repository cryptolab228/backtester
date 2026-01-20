# 🚀 Backtester V2 - Руководство по нативному развертыванию

## Обзор новой системы

Проект полностью переработан для работы **без Docker** с автоматическим управлением всеми сервисами. Система устанавливает и настраивает:

- **PostgreSQL** - нативно в Windows
- **Redis** - портабельная версия для Windows
- **Backend** - Node.js API сервер с автоматическим управлением сервисами
- **Frontend** - Vue.js интерфейс

## 🎯 Быстрый старт

### Одна команда для всего:
```powershell
.\setup-system.ps1 -All
```

Эта команда автоматически:
1. ✅ Установит все Node.js зависимости
2. ✅ Скачает и настроит Redis
3. ✅ Установит PostgreSQL (требует админ права)
4. ✅ Создаст базу данных и таблицы
5. ✅ Запустит все сервисы
6. ✅ Откроет приложение в браузере

## 📋 Пошаговая установка

### 1. Подготовка
```powershell
# Клонируем репозиторий
git clone <repository-url>
cd backtesterv2

# Устанавливаем зависимости Node.js
npm run install:all
```

### 2. Настройка Redis
```powershell
# Автоматическая установка и настройка Redis
npm run setup:redis
# или
.\setup-redis.ps1 -All
```

### 3. Настройка PostgreSQL (требует админ права)
```powershell
# Запустите PowerShell как администратор
.\setup-postgresql.ps1 -All
```

### 4. Запуск системы
```powershell
# Запуск всех сервисов
npm run dev
# или
.\setup-system.ps1 -Start
```

## 🔧 Управление сервисами

### Проверка статуса
```powershell
.\setup-system.ps1 -Status
```

### Запуск сервисов
```powershell
# Все сервисы
.\setup-system.ps1 -Start

# Только Redis
.\setup-redis.ps1 -Start

# Только PostgreSQL
.\setup-postgresql.ps1 -Start
```

### Остановка сервисов
```powershell
# Все сервисы
.\setup-system.ps1 -Stop

# Только Redis
.\setup-redis.ps1 -Stop

# Только PostgreSQL
.\setup-postgresql.ps1 -Stop
```

## 📁 Структура файлов

```
backtesterv2/
├── setup-system.ps1           # Главный скрипт управления
├── setup-postgresql.ps1       # Управление PostgreSQL
├── setup-redis.ps1            # Управление Redis
├── backend/
│   ├── src/
│   │   └── app.ts             # Новый сервер с автоуправлением
│   └── data/
│       └── postgresql/        # Данные PostgreSQL
├── frontend/                  # Vue.js приложение
└── redis-windows/            # Портабельный Redis
```

## 🌐 URL адреса

После запуска доступны:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:5000
- **Portfolio Results**: http://localhost:5000/portfolio-results/

## 🔍 Диагностика проблем

### PostgreSQL не запускается
1. Проверьте права администратора:
   ```powershell
   .\setup-postgresql.ps1 -Status
   ```

2. Переустановите PostgreSQL:
   ```powershell
   .\setup-postgresql.ps1 -All
   ```

3. Проверьте порт 5432:
   ```powershell
   netstat -an | findstr :5432
   ```

### Redis не запускается
1. Проверьте статус:
   ```powershell
   .\setup-redis.ps1 -Status
   ```

2. Переустановите Redis:
   ```powershell
   .\setup-redis.ps1 -All
   ```

3. Проверьте порт 6379:
   ```powershell
   netstat -an | findstr :6379
   ```

### Backend не запускается
1. Проверьте логи в консоли
2. Убедитесь что PostgreSQL и Redis запущены
3. Проверьте файл `.env` в папке `backend`

### Frontend не открывается
1. Проверьте порт 5173:
   ```powershell
   netstat -an | findstr :5173
   ```

2. Запустите отдельно:
   ```bash
   cd frontend
   npm run dev
   ```

## ⚙️ Конфигурация

### PostgreSQL
- **Порт**: 5432
- **Пользователь**: postgres
- **Пароль**: postgres123
- **База данных**: backtester
- **Данные**: `backend/data/postgresql/`

### Redis
- **Порт**: 6379
- **Конфиг**: `redis-windows/redis.windows.conf`
- **Логи**: `backend/logs/redis.log`

### Backend
- **Порт**: 5000
- **Логи**: `backend/logs/combined.log`
- **Конфиг**: `backend/.env`

## 🔄 Обновление системы

```powershell
# Остановить все сервисы
.\setup-system.ps1 -Stop

# Обновить код из репозитория
git pull

# Обновить зависимости
npm run install:all

# Перезапустить
.\setup-system.ps1 -Start
```

## 🏆 Преимущества новой системы

- ✅ **Нативная производительность** - без Docker накладных расходов
- ✅ **Простота управления** - одна команда для всего
- ✅ **Автоматическое восстановление** - сервисы перезапускаются при сбоях
- ✅ **Полная интеграция** - все сервисы управляются из одного места
- ✅ **Windows оптимизация** - специально для Windows окружения

## 🆘 Поддержка

При возникновении проблем:
1. Запустите `.\setup-system.ps1 -Status` для диагностики
2. Проверьте логи в `backend/logs/`
3. Убедитесь что все порты свободны
4. Перезапустите систему: `.\setup-system.ps1 -Stop` затем `.\setup-system.ps1 -Start`

