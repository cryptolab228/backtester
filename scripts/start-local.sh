#!/bin/bash

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функции для вывода
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

echo "🚀 Запуск Backtester V2 в локальном режиме..."
echo "============================================"

# Проверка зависимостей
log_info "Проверка системных зависимостей..."

# Проверка Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js не установлен. Запустите: ./scripts/setup-local-environment.sh"
    exit 1
fi

# Проверка PostgreSQL
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    log_warning "PostgreSQL не запущен. Попытка запуска..."
    
    # Попытка запуска PostgreSQL
    if command -v systemctl &> /dev/null; then
        sudo systemctl start postgresql
    elif command -v brew &> /dev/null; then
        brew services start postgresql
    else
        log_error "Не удалось запустить PostgreSQL автоматически"
        log_info "Запустите PostgreSQL вручную и повторите попытку"
        exit 1
    fi
    
    # Ожидание запуска
    sleep 3
    
    if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
        log_error "PostgreSQL не запущен после попытки автозапуска"
        exit 1
    fi
fi

# Проверка Redis
if ! redis-cli ping > /dev/null 2>&1; then
    log_warning "Redis не запущен. Попытка запуска..."
    
    # Попытка запуска Redis
    if command -v systemctl &> /dev/null; then
        sudo systemctl start redis-server
    elif command -v brew &> /dev/null; then
        brew services start redis
    else
        log_error "Не удалось запустить Redis автоматически"
        log_info "Запустите Redis вручную и повторите попытку"
        exit 1
    fi
    
    # Ожидание запуска
    sleep 2
    
    if ! redis-cli ping > /dev/null 2>&1; then
        log_error "Redis не запущен после попытки автозапуска"
        exit 1
    fi
fi

log_success "Системные зависимости готовы"

# Проверка конфигурационных файлов
log_info "Проверка конфигурационных файлов..."

if [ ! -f "backend/.env" ]; then
    log_warning "backend/.env не найден, создаю из .env.local"
    cp backend/.env.local backend/.env
fi

if [ ! -f "frontend/.env" ]; then
    log_warning "frontend/.env не найден, создаю из .env.local"
    cp frontend/.env.local frontend/.env
fi

# Создание необходимых директорий
log_info "Создание необходимых директорий..."
mkdir -p backend/logs
mkdir -p backend/public/portfolio-results

# Установка зависимостей (если нужно)
if [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
    log_info "Установка зависимостей..."
    
    if [ ! -d "backend/node_modules" ]; then
        log_info "Установка зависимостей backend..."
        cd backend && npm install && cd ..
    fi
    
    if [ ! -d "frontend/node_modules" ]; then
        log_info "Установка зависимостей frontend..."
        cd frontend && npm install && cd ..
    fi
fi

# Функция для остановки процессов при завершении
cleanup() {
    log_info "🛑 Остановка сервисов..."
    
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    
    # Дополнительная очистка процессов
    pkill -f "ts-node-dev.*backtester" 2>/dev/null || true
    pkill -f "vite.*frontend" 2>/dev/null || true
    
    log_success "Сервисы остановлены"
    exit 0
}

# Обработка сигналов
trap cleanup SIGINT SIGTERM EXIT

log_success "🔧 Запуск Backend..."
cd backend
npm run dev &
BACKEND_PID=$!
cd ..

# Ожидание запуска backend
log_info "Ожидание запуска backend (5 секунд)..."
sleep 5

# Проверка, что backend запустился
if ! curl -s http://localhost:5000 > /dev/null 2>&1; then
    log_warning "Backend еще не готов, ожидание..."
    sleep 5
fi

log_success "🎨 Запуск Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

# Ожидание запуска frontend
log_info "Ожидание запуска frontend (3 секунды)..."
sleep 3

echo ""
log_success "🎉 Все сервисы запущены!"
echo ""
log_info "📍 Доступные URL:"
log_info "   🌐 Frontend:   http://localhost:5173"
log_info "   🔌 Backend API: http://localhost:5000"
log_info "   🗄️  PostgreSQL: localhost:5432"
log_info "   📦 Redis:      localhost:6379"
echo ""
log_info "📋 Полезная информация:"
log_info "   • База данных: backtester_db"
log_info "   • Пользователь БД: user"
log_info "   • Логи backend: backend/logs/"
log_info "   • Для остановки: Ctrl+C"
echo ""
log_warning "🔄 Приложение запущено в режиме разработки"
log_info "Изменения в коде будут автоматически перезагружены"
echo ""

# Ожидание завершения
wait