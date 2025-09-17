#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

echo "🛑 Остановка локальных сервисов Backtester V2..."
echo "==============================================="

# Остановка Node.js процессов
log_info "Остановка Backend процессов..."
pkill -f "ts-node-dev.*backtester" 2>/dev/null || true
pkill -f "node.*backtester.*backend" 2>/dev/null || true

log_info "Остановка Frontend процессов..."
pkill -f "vite.*frontend" 2>/dev/null || true
pkill -f "node.*frontend.*vite" 2>/dev/null || true

# Дополнительная очистка по портам
log_info "Освобождение портов..."

# Найти и завершить процессы на портах 5000 и 5173
BACKEND_PORT_PID=$(lsof -ti:5000 2>/dev/null || true)
if [ ! -z "$BACKEND_PORT_PID" ]; then
    kill -9 $BACKEND_PORT_PID 2>/dev/null || true
    log_info "Освобожден порт 5000"
fi

FRONTEND_PORT_PID=$(lsof -ti:5173 2>/dev/null || true)
if [ ! -z "$FRONTEND_PORT_PID" ]; then
    kill -9 $FRONTEND_PORT_PID 2>/dev/null || true
    log_info "Освобожден порт 5173"
fi

# Небольшая пауза для завершения процессов
sleep 2

# Проверка статуса
log_info "Проверка статуса сервисов..."

if ! curl -s --connect-timeout 2 http://localhost:5000 > /dev/null 2>&1; then
    log_success "Backend остановлен"
else
    echo -e "${YELLOW}⚠️  Backend все еще отвечает на порту 5000${NC}"
fi

if ! curl -s --connect-timeout 2 http://localhost:5173 > /dev/null 2>&1; then
    log_success "Frontend остановлен"
else
    echo -e "${YELLOW}⚠️  Frontend все еще отвечает на порту 5173${NC}"
fi

echo ""
log_success "🎉 Локальные сервисы остановлены!"
echo ""
log_info "💡 Системные сервисы (PostgreSQL, Redis) продолжают работать"
log_info "Для их остановки используйте:"

# Определение ОС для корректных команд
if [[ "$OSTYPE" == "linux-gnu"* ]] && command -v systemctl &> /dev/null; then
    log_info "   sudo systemctl stop postgresql redis-server"
elif [[ "$OSTYPE" == "darwin"* ]] && command -v brew &> /dev/null; then
    log_info "   brew services stop postgresql redis"
else
    log_info "   (команды зависят от вашей операционной системы)"
fi

echo ""