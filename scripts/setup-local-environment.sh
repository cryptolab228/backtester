#!/bin/bash

set -e

echo "🚀 Настройка локального окружения для Backtester V2"
echo "=================================================="

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для вывода сообщений
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

# Проверка операционной системы
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt &> /dev/null; then
            OS="ubuntu"
        elif command -v yum &> /dev/null; then
            OS="centos"
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    else
        OS="unknown"
    fi
    
    log_info "Обнаружена ОС: $OS"
}

# Проверка и установка Node.js
setup_nodejs() {
    log_info "Проверка Node.js..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        log_success "Node.js уже установлен: $NODE_VERSION"
        
        # Проверка версии (должна быть 18+)
        MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        if [ "$MAJOR_VERSION" -lt 18 ]; then
            log_warning "Node.js версия $NODE_VERSION устарела. Рекомендуется версия 18+"
        fi
    else
        log_info "Установка Node.js..."
        case $OS in
            ubuntu)
                curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
                sudo apt-get install -y nodejs
                ;;
            macos)
                if command -v brew &> /dev/null; then
                    brew install node
                else
                    log_error "Homebrew не установлен. Установите Node.js вручную: https://nodejs.org/"
                    exit 1
                fi
                ;;
            *)
                log_error "Автоматическая установка Node.js не поддерживается для $OS"
                log_info "Установите Node.js вручную: https://nodejs.org/"
                exit 1
                ;;
        esac
        log_success "Node.js установлен"
    fi
}

# Проверка и установка PostgreSQL
setup_postgresql() {
    log_info "Проверка PostgreSQL..."
    
    if command -v psql &> /dev/null; then
        log_success "PostgreSQL уже установлен"
    else
        log_info "Установка PostgreSQL..."
        case $OS in
            ubuntu)
                sudo apt update
                sudo apt install -y postgresql postgresql-contrib
                sudo systemctl start postgresql
                sudo systemctl enable postgresql
                ;;
            macos)
                if command -v brew &> /dev/null; then
                    brew install postgresql
                    brew services start postgresql
                else
                    log_error "Homebrew не установлен"
                    exit 1
                fi
                ;;
            *)
                log_error "Автоматическая установка PostgreSQL не поддерживается для $OS"
                exit 1
                ;;
        esac
        log_success "PostgreSQL установлен"
    fi
}

# Проверка и установка TimescaleDB
setup_timescaledb() {
    log_info "Проверка TimescaleDB..."
    
    case $OS in
        ubuntu)
            # Добавление репозитория TimescaleDB
            if ! grep -q "timescale" /etc/apt/sources.list.d/* 2>/dev/null; then
                log_info "Добавление репозитория TimescaleDB..."
                sudo add-apt-repository -y ppa:timescale/timescaledb-ppa
                sudo apt update
            fi
            
            # Установка TimescaleDB
            if ! dpkg -l | grep -q timescaledb; then
                log_info "Установка TimescaleDB..."
                sudo apt install -y timescaledb-2-postgresql-14
            fi
            ;;
        macos)
            if command -v brew &> /dev/null; then
                if ! brew list | grep -q timescaledb; then
                    log_info "Установка TimescaleDB..."
                    brew tap timescale/tap
                    brew install timescaledb
                fi
            fi
            ;;
    esac
    
    log_success "TimescaleDB настроен"
}

# Проверка и установка Redis
setup_redis() {
    log_info "Проверка Redis..."
    
    if command -v redis-cli &> /dev/null; then
        log_success "Redis уже установлен"
    else
        log_info "Установка Redis..."
        case $OS in
            ubuntu)
                sudo apt install -y redis-server
                sudo systemctl start redis-server
                sudo systemctl enable redis-server
                ;;
            macos)
                if command -v brew &> /dev/null; then
                    brew install redis
                    brew services start redis
                else
                    log_error "Homebrew не установлен"
                    exit 1
                fi
                ;;
            *)
                log_error "Автоматическая установка Redis не поддерживается для $OS"
                exit 1
                ;;
        esac
        log_success "Redis установлен"
    fi
}

# Настройка базы данных
setup_database() {
    log_info "Настройка базы данных..."
    
    # Проверка, что PostgreSQL запущен
    if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
        log_info "Запуск PostgreSQL..."
        case $OS in
            ubuntu)
                sudo systemctl start postgresql
                ;;
            macos)
                brew services start postgresql
                ;;
        esac
        
        # Ожидание запуска
        sleep 3
    fi
    
    # Создание базы данных и пользователя
    log_info "Создание базы данных и пользователя..."
    sudo -u postgres psql << EOF
-- Удаление существующих (если есть)
DROP DATABASE IF EXISTS backtester_db;
DROP USER IF EXISTS "user";

-- Создание пользователя и базы данных
CREATE USER "user" WITH PASSWORD 'password';
CREATE DATABASE backtester_db OWNER "user";

-- Предоставление прав
GRANT ALL PRIVILEGES ON DATABASE backtester_db TO "user";
ALTER USER "user" CREATEDB;

\q
EOF

    # Активация TimescaleDB
    log_info "Активация TimescaleDB..."
    sudo -u postgres psql -d backtester_db << EOF
CREATE EXTENSION IF NOT EXISTS timescaledb;
\q
EOF

    log_success "База данных настроена"
    log_info "   - База: backtester_db"
    log_info "   - Пользователь: user" 
    log_info "   - Пароль: password"
}

# Проверка Redis
check_redis() {
    log_info "Проверка Redis..."
    
    if ! redis-cli ping > /dev/null 2>&1; then
        log_info "Запуск Redis..."
        case $OS in
            ubuntu)
                sudo systemctl start redis-server
                ;;
            macos)
                brew services start redis
                ;;
        esac
        
        # Ожидание запуска
        sleep 2
    fi
    
    if redis-cli ping > /dev/null 2>&1; then
        log_success "Redis работает"
    else
        log_error "Не удалось запустить Redis"
        exit 1
    fi
}

# Установка зависимостей проекта
install_dependencies() {
    log_info "Установка зависимостей проекта..."
    
    # Backend
    log_info "Установка зависимостей backend..."
    cd backend
    npm install
    cd ..
    
    # Frontend
    log_info "Установка зависимостей frontend..."
    cd frontend
    npm install
    cd ..
    
    log_success "Зависимости установлены"
}

# Создание необходимых директорий
create_directories() {
    log_info "Создание необходимых директорий..."
    
    mkdir -p backend/logs
    mkdir -p backend/public/portfolio-results
    
    log_success "Директории созданы"
}

# Копирование конфигурационных файлов
setup_config_files() {
    log_info "Настройка конфигурационных файлов..."
    
    # Backend .env
    if [ ! -f "backend/.env" ]; then
        cp backend/.env.local backend/.env
        log_success "Создан backend/.env"
    else
        log_warning "backend/.env уже существует"
    fi
    
    # Frontend .env
    if [ ! -f "frontend/.env" ]; then
        cp frontend/.env.local frontend/.env
        log_success "Создан frontend/.env"
    else
        log_warning "frontend/.env уже существует"
    fi
}

# Проверка финальной настройки
final_check() {
    log_info "Финальная проверка настройки..."
    
    # Проверка Node.js
    if command -v node &> /dev/null; then
        log_success "Node.js: $(node --version)"
    else
        log_error "Node.js не найден"
        exit 1
    fi
    
    # Проверка PostgreSQL
    if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
        log_success "PostgreSQL: запущен"
    else
        log_error "PostgreSQL не запущен"
        exit 1
    fi
    
    # Проверка Redis
    if redis-cli ping > /dev/null 2>&1; then
        log_success "Redis: запущен"
    else
        log_error "Redis не запущен"
        exit 1
    fi
    
    # Проверка TimescaleDB
    if sudo -u postgres psql -d backtester_db -c "SELECT * FROM pg_extension WHERE extname='timescaledb';" 2>/dev/null | grep -q timescaledb; then
        log_success "TimescaleDB: активирован"
    else
        log_warning "TimescaleDB не активирован"
    fi
}

# Главная функция
main() {
    echo ""
    log_info "Начало настройки локального окружения..."
    echo ""
    
    detect_os
    setup_nodejs
    setup_postgresql
    setup_timescaledb
    setup_redis
    setup_database
    check_redis
    install_dependencies
    create_directories
    setup_config_files
    final_check
    
    echo ""
    log_success "🎉 Локальное окружение настроено!"
    echo ""
    log_info "Следующие шаги:"
    log_info "1. Отредактируйте backend/.env и frontend/.env при необходимости"
    log_info "2. Запустите приложение: ./scripts/start-local.sh"
    log_info "3. Откройте http://localhost:5173 в браузере"
    echo ""
}

# Запуск
main "$@"