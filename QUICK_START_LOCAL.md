# 🚀 Быстрый старт локальной разработки

## TL;DR - Для опытных разработчиков

```bash
# Клонирование (если нужно)
git clone <repository-url> && cd backtesterv2

# Автоустановка всего окружения  
./scripts/setup-local-environment.sh

# Запуск приложения
./scripts/start-local.sh

# Открыть в браузере: http://localhost:5173
```

## 📋 Что нужно знать

### Системные требования:
- **Ubuntu/Debian** или **macOS**
- **Права sudo** (для установки PostgreSQL/Redis)
- **Интернет** (для загрузки зависимостей)

### Что будет установлено:
- Node.js 18+ (если не установлен)
- PostgreSQL 14+ с TimescaleDB
- Redis 6+
- Зависимости проекта (npm install)

### Порты:
- `5173` - Frontend (Vue.js)
- `5000` - Backend API (Node.js)
- `5432` - PostgreSQL
- `6379` - Redis

## 🛠️ Полезные команды

```bash
# Проверить статус окружения
./scripts/check-local-environment.sh

# Остановить все сервисы
./scripts/stop-local.sh

# Сбросить данные (очистить БД)
./scripts/reset-local-data.sh

# Универсальный инструмент
./scripts/dev-tools.sh help
```

## 🔧 Быстрое решение проблем

### PostgreSQL не запускается:
```bash
sudo systemctl start postgresql
# или для macOS: brew services start postgresql
```

### Redis не запускается:
```bash
sudo systemctl start redis-server
# или для macOS: brew services start redis
```

### Порт занят:
```bash
./scripts/stop-local.sh
# или принудительно: kill -9 $(lsof -ti:5000)
```

### Проблемы с зависимостями:
```bash
./scripts/dev-tools.sh install
```

## 📖 Подробная документация

- **[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)** - Полное руководство
- **[docs/LOCAL_DEVELOPMENT_PLAN.md](docs/LOCAL_DEVELOPMENT_PLAN.md)** - Детальный план
- **[README.md](README.md)** - Основная документация проекта

## ⚡ Преимущества локальной разработки

- **3-5x быстрее** запуск по сравнению с Docker
- **Мгновенный Hot Reload** для фронтенда
- **Прямая отладка** в IDE
- **Нативная производительность**

---

**Готово!** Теперь можете разрабатывать на полной скорости! 🎉