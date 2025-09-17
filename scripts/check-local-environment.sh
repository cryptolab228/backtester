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

echo "🔍 Проверка локального окружения Backtester V2..."
echo "================================================"

# Счетчики
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNING=0

check_command() {
    local cmd=$1
    local name=$2
    local required=${3:-true}
    
    if command -v $cmd &> /dev/null; then
        if [ "$cmd" = "node" ]; then
            VERSION=$(node --version)
            MAJOR_VERSION=$(echo $VERSION | cut -d'.' -f1 | sed 's/v//')
            if [ "$MAJOR_VERSION" -ge 18 ]; then
                log_success "$name: $VERSION"
                ((CHECKS_PASSED++))
            else
                log_warning "$name: $VERSION (рекомендуется 18+)"
                ((CHECKS_WARNING++))
            fi
        elif [ "$cmd" = "psql" ]; then
            VERSION=$(psql --version | head -n1)
            log_success "$name: $VERSION"
            ((CHECKS_PASSED++))
        else
            log_success "$name: установлен"
            ((CHECKS_PASSED++))
        fi
    else
        if [ "$required" = "true" ]; then
            log_error "$name не установлен"
            ((CHECKS_FAILED++))
        else
            log_warning "$name не установлен (опционально)"
            ((CHECKS_WARNING++))
        fi
    fi
}

check_service() {
    local service=$1
    local name=$2
    local check_cmd=$3
    
    if eval $check_cmd > /dev/null 2>&1; then
        log_success "$name: запущен и доступен"
        ((CHECKS_PASSED++))
    else
        log_error "$name: не запущен или недоступен"
        ((CHECKS_FAILED++))
    fi
}

check_file() {
    local file=$1
    local name=$2
    local required=${3:-true}
    
    if [ -f "$file" ]; then
        log_success "$name: найден"
        ((CHECKS_PASSED++))
    else
        if [ "$required" = "true" ]; then
            log_error "$name: не найден"
            ((CHECKS_FAILED++))
        else
            log_warning "$name: не найден"
            ((CHECKS_WARNING++))
        fi
    fi
}

check_directory() {
    local dir=$1
    local name=$2
    
    if [ -d "$dir" ]; then
        log_success "$name: найден"
        ((CHECKS_PASSED++))
    else
        log_warning "$name: не найден"
        ((CHECKS_WARNING++))
    fi
}

echo ""
log_info "🔧 Проверка системных зависимостей..."
echo ""

# Проверка основных команд
check_command "node" "Node.js" true
check_command "npm" "npm" true
check_command "psql" "PostgreSQL" true
check_command "redis-cli" "Redis CLI" true
check_command "git" "Git" false
check_command "curl" "cURL" false

echo ""
log_info "🗄️  Проверка сервисов баз данных..."
echo ""

# Проверка сервисов
check_service "PostgreSQL" "PostgreSQL Server" "pg_isready -h localhost -p 5432"
check_service "Redis" "Redis Server" "redis-cli ping"

echo ""
log_info "📁 Проверка структуры проекта..."
echo ""

# Проверка файлов проекта
check_file "backend/package.json" "Backend package.json" true
check_file "frontend/package.json" "Frontend package.json" true
check_file "backend/.env" "Backend .env" false
check_file "frontend/.env" "Frontend .env" false
check_file "backend/.env.local" "Backend .env.local" true
check_file "frontend/.env.local" "Frontend .env.local" true

# Проверка директорий
check_directory "backend/node_modules" "Backend node_modules"
check_directory "frontend/node_modules" "Frontend node_modules"
check_directory "backend/logs" "Backend logs directory"
check_directory "backend/public/portfolio-results" "Portfolio results directory"

echo ""
log_info "🔌 Проверка доступности портов..."
echo ""

# Проверка портов
check_port() {
    local port=$1
    local name=$2
    
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        log_warning "Порт $port ($name): занят"
        ((CHECKS_WARNING++))
    else
        log_success "Порт $port ($name): свободен"
        ((CHECKS_PASSED++))
    fi
}

check_port 5000 "Backend API"
check_port 5173 "Frontend Dev Server"
check_port 5432 "PostgreSQL"
check_port 6379 "Redis"

echo ""
log_info "🗃️  Проверка базы данных..."
echo ""

# Проверка базы данных
if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    # Проверка существования базы данных
    if psql -h localhost -U user -d backtester_db -c "\q" 2>/dev/null; then
        log_success "База данных backtester_db: доступна"
        ((CHECKS_PASSED++))
        
        # Проверка TimescaleDB
        if psql -h localhost -U user -d backtester_db -c "SELECT * FROM pg_extension WHERE extname='timescaledb';" 2>/dev/null | grep -q timescaledb; then
            log_success "TimescaleDB: активирован"
            ((CHECKS_PASSED++))
        else
            log_warning "TimescaleDB: не активирован"
            ((CHECKS_WARNING++))
        fi
        
        # Проверка таблиц
        TABLES=$(psql -h localhost -U user -d backtester_db -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
        if [ "$TABLES" -gt 0 ]; then
            log_success "Таблицы базы данных: найдено $TABLES таблиц"
            ((CHECKS_PASSED++))
        else
            log_warning "Таблицы базы данных: не найдены (будут созданы при первом запуске)"
            ((CHECKS_WARNING++))
        fi
    else
        log_error "База данных backtester_db: недоступна"
        ((CHECKS_FAILED++))
    fi
else
    log_error "PostgreSQL недоступен для проверки базы данных"
    ((CHECKS_FAILED++))
fi

echo ""
log_info "📊 Сводка проверки..."
echo ""

TOTAL_CHECKS=$((CHECKS_PASSED + CHECKS_FAILED + CHECKS_WARNING))

echo -e "Всего проверок: $TOTAL_CHECKS"
echo -e "${GREEN}✅ Успешно: $CHECKS_PASSED${NC}"
echo -e "${YELLOW}⚠️  Предупреждения: $CHECKS_WARNING${NC}"
echo -e "${RED}❌ Ошибки: $CHECKS_FAILED${NC}"

echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    if [ $CHECKS_WARNING -eq 0 ]; then
        log_success "🎉 Окружение полностью готово для разработки!"
        echo ""
        log_info "Следующие шаги:"
        log_info "1. Запустите: ./scripts/start-local.sh"
        log_info "2. Откройте http://localhost:5173"
    else
        log_warning "✨ Окружение готово для разработки с некоторыми предупреждениями"
        echo ""
        log_info "Рекомендуется исправить предупреждения для оптимальной работы"
        log_info "Затем запустите: ./scripts/start-local.sh"
    fi
else
    log_error "🚨 Обнаружены критические проблемы!"
    echo ""
    log_info "Для исправления проблем:"
    log_info "1. Запустите: ./scripts/setup-local-environment.sh"
    log_info "2. Повторите проверку: ./scripts/check-local-environment.sh"
fi

echo ""

exit $CHECKS_FAILED