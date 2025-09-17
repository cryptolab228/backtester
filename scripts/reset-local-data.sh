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

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

echo "🔄 Сброс локальных данных разработки..."
echo "====================================="

# Подтверждение действия
read -p "⚠️  Это действие удалит все данные из базы данных и Redis. Продолжить? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Операция отменена"
    exit 0
fi

# Проверка, что сервисы запущены
log_info "Проверка доступности сервисов..."

if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    log_error "PostgreSQL недоступен"
    exit 1
fi

if ! redis-cli ping > /dev/null 2>&1; then
    log_error "Redis недоступен"
    exit 1
fi

# Очистка Redis
log_info "Очистка Redis..."
redis-cli FLUSHALL > /dev/null 2>&1
if [ $? -eq 0 ]; then
    log_success "Redis очищен"
else
    log_error "Ошибка при очистке Redis"
fi

# Очистка PostgreSQL
log_info "Очистка PostgreSQL..."
psql -h localhost -U user -d backtester_db << EOF > /dev/null 2>&1
TRUNCATE TABLE candles CASCADE;
TRUNCATE TABLE trading_pairs CASCADE;
TRUNCATE TABLE settings CASCADE;
EOF

if [ $? -eq 0 ]; then
    log_success "PostgreSQL очищен"
else
    log_warning "Возможная ошибка при очистке PostgreSQL (таблицы могут не существовать)"
fi

# Очистка файлов результатов
log_info "Очистка файлов результатов..."
if [ -d "backend/public/portfolio-results" ]; then
    rm -f backend/public/portfolio-results/*.json
    log_success "Файлы результатов очищены"
fi

# Очистка логов
log_info "Очистка логов..."
if [ -d "backend/logs" ]; then
    rm -f backend/logs/*.log
    log_success "Логи очищены"
fi

echo ""
log_success "🎉 Локальные данные сброшены!"
echo ""
log_info "Данные будут пересозданы при следующем запуске приложения"