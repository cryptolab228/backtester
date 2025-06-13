#!/bin/bash

# Скрипт тестирования оптимизированного алгоритма получения свечей

echo '🚀 Тестирование оптимизированного алгоритма получения свечей OKX API'
echo '=================================================================='

# Проверяем что сервер запущен
echo '1. Проверка статуса сервера...'
curl -s http://localhost:5000/health > /dev/null
if [ $? -eq 0 ]; then
    echo '✅ Backend сервер доступен'
else
    echo '❌ Backend сервер недоступен. Запустите docker-compose up -d'
    exit 1
fi

# Проверяем фронтенд
curl -s http://localhost:5173 > /dev/null
if [ $? -eq 0 ]; then
    echo '✅ Frontend доступен'
else
    echo '❌ Frontend недоступен'
fi

echo ''
echo '2. Включение детального логирования...'
# Устанавливаем debug режим для детального мониторинга
docker exec backtester-backend sh -c "export LOG_LEVEL=debug"

echo ''
echo '3. Мониторинг производительности...'
echo 'Статистика использования ресурсов ПЕРЕД тестом:'
docker stats --no-stream backtester-backend

echo ''
echo '4. Проверка логов rate limiter и optimized fetcher...'
echo 'Ожидайте логи с префиксами:'
echo '  - [RateLimiter] - статистика rate limiting'
echo '  - [OptimizedFetcher] - прогресс параллельной загрузки'  
echo '  - [OKX-Optimized] - результаты оптимизированных запросов'
echo '  - [Job-OPT] - обработка задач с новым алгоритмом'

echo ''
echo '5. Текущие логи backend (последние 20 строк):'
docker logs backtester-backend --tail 20

echo ''
echo '🎯 ИНСТРУКЦИИ ДЛЯ ТЕСТИРОВАНИЯ:'
echo ''
echo 'А) Тест единичной загрузки:'
echo '   1. Откройте http://localhost:5173'
echo '   2. Перейдите в раздел "Data Management"'
echo '   3. Загрузите свечи для одного символа'
echo '   4. Следите за логами: docker logs backtester-backend -f'
echo ''
echo 'Б) Тест портфельного бэктеста (ОПТИМИЗИРОВАННЫЙ):'
echo '   1. Перейдите в раздел "Portfolio Backtest"'
echo '   2. Выберите 3-5 торговых пар'
echo '   3. Запустите портфельный бэктест'
echo '   4. Следите за логами с префиксом [Job-OPT]'
echo ''
echo 'В) Сравнение производительности:'
echo '   Сравните скорость загрузки с предыдущими запусками'
echo '   Ожидаемое ускорение: 3-4x для портфельных тестов'
echo ''
echo '📊 МЕТРИКИ ДЛЯ ОТСЛЕЖИВАНИЯ:'
echo '- Количество запросов к API'
echo '- Время загрузки свечей'
echo '- Эффективность (свечей на запрос)'
echo '- Статистика rate limiter'
echo '- Использование памяти и CPU'

echo ''
echo '🔍 Команды для мониторинга:'
echo ''
echo '# Логи в реальном времени'
echo 'docker logs backtester-backend -f'
echo ''
echo '# Статистика ресурсов'
echo 'docker stats backtester-backend'
echo ''
echo '# Поиск логов оптимизированного fetcher'
echo 'docker logs backtester-backend | grep -E "(OptimizedFetcher|Job-OPT|RateLimiter)"'
echo ''
echo '# Статистика производительности'
echo 'docker logs backtester-backend | grep -E "(requests.*candles.*ms)"'

echo ''
echo '✅ Готово к тестированию! Запустите портфельный бэктест для проверки оптимизаций.' 