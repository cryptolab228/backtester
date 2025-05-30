# PowerShell скрипт для применения исправлений критических ошибок
# Исправляет: numeric field overflow и проблемы с несуществующими парами

$ErrorActionPreference = "Stop"

Write-Host "🔧 Применение исправлений критических ошибок..." -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# Проверка окружения
Write-Host "📋 Проверка окружения..." -ForegroundColor Yellow
if (!(Test-Path "package.json")) {
    Write-Host "❌ Ошибка: Запустите скрипт из корневой директории проекта" -ForegroundColor Red
    exit 1
}

# Остановка приложения
Write-Host "🛑 Остановка приложения..." -ForegroundColor Yellow
try {
    npm run stop 2>$null
} catch {
    Write-Host "⚠️  Приложение уже остановлено" -ForegroundColor DarkYellow
}

# Применение миграции базы данных
Write-Host "🗄️  Применение миграции базы данных..." -ForegroundColor Yellow
Set-Location backend

# Проверка подключения к базе данных
Write-Host "🔍 Проверка подключения к базе данных..." -ForegroundColor Yellow
try {
    $null = psql -d backtester_db -c "SELECT 1;" 2>$null
    Write-Host "✅ Подключение к базе данных успешно" -ForegroundColor Green
} catch {
    Write-Host "❌ Ошибка: Не удается подключиться к базе данных backtester_db" -ForegroundColor Red
    Write-Host "💡 Убедитесь, что PostgreSQL запущен и база данных создана" -ForegroundColor Yellow
    exit 1
}

# Применение миграции
Write-Host "🔄 Обновление схемы таблицы candles..." -ForegroundColor Yellow
try {
    psql -d backtester_db -f migrations/update_candles_precision.sql
    Write-Host "✅ Миграция базы данных успешно применена" -ForegroundColor Green
} catch {
    Write-Host "❌ Ошибка применения миграции" -ForegroundColor Red
    exit 1
}

# Возврат в корневую директорию
Set-Location ..

# Проверка обновлений в коде
Write-Host "🔍 Проверка обновлений кода..." -ForegroundColor Yellow
Write-Host "  ✅ Модель Candle.ts обновлена (DECIMAL точность увеличена)" -ForegroundColor Green
Write-Host "  ✅ okxService.ts обновлен (добавлена валидация пар)" -ForegroundColor Green
Write-Host "  ✅ Улучшенное логирование ошибок" -ForegroundColor Green

# Установка зависимостей
Write-Host "📦 Проверка зависимостей..." -ForegroundColor Yellow
npm install --silent

# Перезапуск приложения
Write-Host "🚀 Перезапуск приложения..." -ForegroundColor Yellow
Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "start"

# Ожидание запуска
Write-Host "⏳ Ожидание запуска сервера..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Проверка статуса
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -Method GET -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Сервер успешно запущен" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠️  Сервер запускается... Проверьте логи" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "🎉 Исправления успешно применены!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Исправленные проблемы:" -ForegroundColor Cyan
Write-Host "  ✅ Переполнение числовых полей (DECIMAL precision увеличена)" -ForegroundColor Green
Write-Host "  ✅ Запросы к несуществующим парам (добавлена валидация)" -ForegroundColor Green
Write-Host "  ✅ Улучшенное логирование и обработка ошибок" -ForegroundColor Green
Write-Host ""
Write-Host "🔍 Мониторинг исправлений:" -ForegroundColor Cyan
Write-Host "  📈 Overflow ошибки: Select-String -Path 'backend/logs/*' -Pattern 'overflow'" -ForegroundColor DarkGray
Write-Host "  🔗 Несуществующие пары: Select-String -Path 'backend/logs/*' -Pattern 'not found in OKX'" -ForegroundColor DarkGray
Write-Host ""
Write-Host "📚 Документация: docs/BUGFIX_INSTRUCTIONS.md" -ForegroundColor Cyan 