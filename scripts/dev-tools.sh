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

show_help() {
    echo "🛠️  Инструменты разработки Backtester V2"
    echo "======================================"
    echo ""
    echo "Использование: $0 [команда]"
    echo ""
    echo "Доступные команды:"
    echo "  check       - Проверить состояние окружения"
    echo "  start       - Запустить все сервисы"
    echo "  stop        - Остановить все сервисы"
    echo "  restart     - Перезапустить все сервисы"
    echo "  reset       - Сбросить данные"
    echo "  logs        - Показать логи backend"
    echo "  db          - Подключиться к базе данных"
    echo "  redis       - Подключиться к Redis"
    echo "  test        - Запустить тесты"
    echo "  install     - Переустановить зависимости"
    echo "  build       - Собрать проект"
    echo "  help        - Показать эту справку"
    echo ""
}

check_env() {
    ./scripts/check-local-environment.sh
}

start_services() {
    ./scripts/start-local.sh
}

stop_services() {
    ./scripts/stop-local.sh
}

restart_services() {
    log_info "Перезапуск сервисов..."
    ./scripts/stop-local.sh
    sleep 2
    ./scripts/start-local.sh
}

reset_data() {
    ./scripts/reset-local-data.sh
}

show_logs() {
    if [ -d "backend/logs" ] && [ "$(ls -A backend/logs)" ]; then
        log_info "Показ последних логов backend..."
        tail -f backend/logs/*.log
    else
        log_info "Логи не найдены. Запустите backend для создания логов."
    fi
}

connect_db() {
    log_info "Подключение к PostgreSQL..."
    psql -h localhost -U user -d backtester_db
}

connect_redis() {
    log_info "Подключение к Redis..."
    redis-cli
}

run_tests() {
    log_info "Запуск тестов backend..."
    cd backend
    npm run test:local
    cd ..
}

install_deps() {
    log_info "Переустановка зависимостей..."
    
    log_info "Backend..."
    cd backend
    rm -rf node_modules package-lock.json
    npm install
    cd ..
    
    log_info "Frontend..."
    cd frontend  
    rm -rf node_modules package-lock.json
    npm install
    cd ..
    
    log_success "Зависимости переустановлены"
}

build_project() {
    log_info "Сборка проекта..."
    
    log_info "Сборка backend..."
    cd backend
    npm run build
    cd ..
    
    log_info "Сборка frontend..."
    cd frontend
    npm run build:local
    cd ..
    
    log_success "Проект собран"
}

# Обработка команд
case "$1" in
    "check")
        check_env
        ;;
    "start")
        start_services
        ;;
    "stop")
        stop_services
        ;;
    "restart")
        restart_services
        ;;
    "reset")
        reset_data
        ;;
    "logs")
        show_logs
        ;;
    "db")
        connect_db
        ;;
    "redis")
        connect_redis
        ;;
    "test")
        run_tests
        ;;
    "install")
        install_deps
        ;;
    "build")
        build_project
        ;;
    "help"|""|*)
        show_help
        ;;
esac