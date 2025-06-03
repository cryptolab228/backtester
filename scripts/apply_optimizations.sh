#!/bin/bash

# Скрипт применения оптимизаций производительности Backtester V2

echo '🚀 Применение оптимизаций производительности...'

# 1. Устанавливаем production режим
echo '📝 Устанавливаем NODE_ENV=production...'
export NODE_ENV=production

# 2. Перезапускаем контейнеры с новыми ресурсными лимитами
echo '🔄 Перезапускаем Docker контейнеры с новыми лимитами...'
docker-compose down
docker-compose up -d

# 3. Ждем инициализации
echo '⏳ Ждем инициализации сервисов...'
sleep 10

# 4. Проверяем статус контейнеров
echo '📊 Проверяем статус контейнеров:'
docker-compose ps

# 5. Проверяем использование ресурсов
echo '💾 Текущее использование ресурсов:'
docker stats --no-stream backtester-backend

# 6. Проверяем размер логов
echo '📄 Размер файлов логов:'
ls -lh backend/logs/ 2>/dev/null || echo 'Папка логов еще не создана'

echo '✅ Оптимизации применены!'
echo ''
echo '🔍 Полезные команды для мониторинга:'
echo '  docker stats backtester-backend          # Мониторинг ресурсов'
echo '  docker logs backtester-backend --tail 50 # Просмотр логов'
echo '  grep "CLOSED.*trade" backend/logs/combined.log | tail -10  # Закрытие позиций'
echo '  grep "SKIPPED signal" backend/logs/combined.log | tail -10 # Пропущенные сигналы'
echo ''
echo '🌐 Сервисы доступны на:'
echo '  Frontend: http://localhost:8080'
echo '  Backend API: http://localhost:5000' 