# Оптимизация Производительности Backtester V2

## 🚀 Выполненные оптимизации

### 1. **Ресурсы Docker контейнеров**

#### Backend контейнер
```yaml
# docker-compose.yml
backend:
  environment:
    NODE_OPTIONS: "--max-old-space-size=4096 --max-semi-space-size=128"
  deploy:
    resources:
      reservations:
        memory: 2G
        cpus: '2.0'
      limits:
        memory: 4G
        cpus: '4.0'
  mem_limit: 4g
  cpus: 4.0
  mem_reservation: 2g
```

**Изменения:**
- ✅ Увеличена память до 4GB (лимит) и 2GB (резерв)
- ✅ Выделено до 4 ядер процессора
- ✅ Настроены параметры Node.js для работы с большими объемами данных

### 2. **Оптимизация логирования**

#### Проблема
- 1.6 млн строк логов за один портфельный бэктест
- Огромный размер файлов логов
- Замедление сервера из-за интенсивного логирования

#### Решение
```typescript
// backend/src/config/logger.ts
const getLogLevel = () => {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return 'info'; // Отключаем debug логи в production
    case 'test':
      return 'error';
    default:
      return 'debug';
  }
};
```

**Изменения:**
- ✅ Отключены debug логи в production режиме
- ✅ Добавлена ротация логов (максимум 100MB на файл, 10 файлов)
- ✅ Компактный формат логирования в production
- ✅ Селективное логирование в критических участках кода

### 3. **Оптимизация WebSocket передачи данных**

#### Проблема
- Ошибка "Invalid string length" при отправке больших портфельных результатов
- Результаты не отображались во фронтенде

#### Решение
```typescript
// backend/src/websocket.ts
const MAX_WEBSOCKET_MESSAGE_SIZE = 50 * 1024 * 1024; // 50MB
const LARGE_MESSAGE_THRESHOLD = 10 * 1024 * 1024; // 10MB

// Сжатие больших данных
const compressData = (data: any): Promise<string> => {
  return new Promise((resolve, reject) => {
    const jsonString = JSON.stringify(data);
    if (jsonString.length < LARGE_MESSAGE_THRESHOLD) {
      resolve(jsonString);
      return;
    }

    zlib.gzip(jsonString, (err, compressed) => {
      // ... сжатие данных
    });
  });
};

// Уменьшение размера данных
const reduceDataSize = (data: any): any => {
  if (data.type === 'PORTFOLIO_BACKTEST_COMPLETED') {
    return {
      ...data,
      payload: {
        ...data.payload,
        result: {
          ...result,
          // Ограничиваем до первых 100 сделок на пару
          tradesByPair: Object.fromEntries(
            Object.entries(result.tradesByPair || {}).map(([pair, trades]) => [
              pair,
              trades.slice(0, 100)
            ])
          ),
          // Ограничиваем до первых 1000 свечей на пару
          strategyCandlesByPair: result.strategyCandlesByPair ? 
            Object.fromEntries(
              Object.entries(result.strategyCandlesByPair).map(([pair, candles]) => [
                pair,
                candles.slice(0, 1000)
              ])
            ) : undefined,
          _dataReduced: true,
          _originalTradesCount: originalTradesCount
        }
      }
    };
  }
  return data;
};
```

**Изменения:**
- ✅ Добавлено сжатие больших WebSocket сообщений с помощью gzip
- ✅ Автоматическое уменьшение размера данных при превышении лимитов
- ✅ Graceful fallback при ошибках передачи
- ✅ Уведомления пользователя о сжатии/уменьшении данных

### 4. **Оптимизация портфельного бэктестера**

#### Проблема с лимитом 15 позиций
- После достижения лимита 15 одновременных позиций новые сделки не открывались
- Неясно работает ли логика закрытия позиций

#### Решение
```typescript
// backend/src/modules/backtester/backtester.ts

// Улучшенное логирование закрытия позиций
logger.info(`[RunPortfolioBacktest] CLOSED ${activeTrade.direction} trade for ${pairSymbol} (${exitReason}). PnL: ${pnl.toFixed(2)}. Active trades: ${activeTradesPortfolio.size}/${maxConcurrentTrades}. Portfolio Capital: ${currentPortfolioCapital.toFixed(2)}`);

// Подробная статистика обработки сигналов
logger.info(`[ProcessPortfolioSignals] Processing ${signals.length} signals with capital ${currentPortfolioCapital}. Active trades: ${activeTradesPortfolio.size}/${maxConcurrentTrades}`);

// Логирование каждого пропущенного сигнала
logger.info(`[ProcessPortfolioSignals] SKIPPED signal ${signalsProcessed}/${signals.length} for ${signal.pairSymbol} (${signal.direction}, strength: ${signal.signalStrength.toFixed(2)}) - Max concurrent trades limit (${maxConcurrentTrades}) reached. Active: ${activeTradesPortfolio.size}`);

// Итоговая статистика
logger.info(`[ProcessPortfolioSignals] Finished processing signals. Active trades: ${activeTradesPortfolio.size}/${maxConcurrentTrades}. Signals stats: Processed=${signalsProcessed}, SkippedLimit=${signalsSkippedDueToLimit}, SkippedATR=${signalsSkippedDueToATR}, SkippedCapital=${signalsSkippedDueToCapital}`);
```

**Изменения:**
- ✅ Подробное логирование открытия/закрытия позиций
- ✅ Отслеживание количества активных сделок в реальном времени
- ✅ Статистика пропущенных сигналов с причинами
- ✅ Исправлено: изменен `break` на `continue` для обработки всех сигналов

### 5. **Frontend оптимизации**

#### WebSocket обработка
```typescript
// frontend/src/views/BacktesterView.vue

// Обработка WebSocket ошибок
else if (message.type === 'WEBSOCKET_ERROR' && message.payload) {
  if (message.payload.message?.includes('Portfolio backtest results too large')) {
    // Восстановление из localStorage
    const savedResults = localStorage.getItem(PORTFOLIO_RESULTS_KEY);
    if (savedResults) {
      const parsedResults = JSON.parse(savedResults);
      backtestStore.portfolioResults = parsedResults;
    }
  }
}

// Обработка сжатых данных
else if (message._compressed) {
  safeToast({ 
    severity: 'info',
    summary: 'Данные сжаты',
    detail: `Получены сжатые результаты (${Math.round(message.compressedSize / 1024)}KB). Обработка...`,
    life: 3000
  });
}

// Обработка уменьшенных данных
else if (message.payload?.result?._dataReduced) {
  const originalCount = message.payload.result._originalTradesCount || 0;
  safeToast({ 
    severity: 'warn',
    summary: 'Данные сокращены',
    detail: `Отображаются сокращенные результаты из-за большого объема данных. Всего было ${originalCount} сделок.`,
    life: 6000
  });
}
```

**Изменения:**
- ✅ Умная обработка ошибок передачи данных
- ✅ Автоматическое восстановление результатов из localStorage
- ✅ Уведомления о сжатии/уменьшении данных
- ✅ Fallback механизмы для больших результатов

### 7. **Результаты тестирования оптимизаций**

#### Статистика использования ресурсов
```bash
# Проверено: 01.06.2025 15:57
CONTAINER ID   NAME                 CPU %     MEM USAGE / LIMIT   MEM %     NET I/O         BLOCK I/O   PIDS
4d74e28ddf62   backtester-backend   0.00%     38.66MiB / 4GiB     0.94%     288kB / 281kB   0B / 0B     11
```

**Результаты:**
- ✅ **Память**: 4GB лимит успешно применен (было: ~1GB по умолчанию)
- ✅ **Использование памяти**: 38.66MiB в состоянии покоя (0.94% от лимита)
- ✅ **CPU**: 4 ядра доступны для вычислений (было: ограничено системой)
- ✅ **Node.js heap**: Настроен на 4GB максимум

#### Проблемы выявленные и решения

**❌ Проблема**: Лог файл 1.6 млн строк замедляет сервер
- **✅ Решение**: Ротация логов (100MB максимум, 10 файлов)
- **✅ Решение**: Production режим отключает debug логи

**❌ Проблема**: "Invalid string length" при больших результатах  
- **✅ Решение**: Сжатие WebSocket сообщений >10MB
- **✅ Решение**: Разбивка данных на части при необходимости
- **✅ Решение**: Уменьшение размера данных (100 сделок/пара, 1000 свечей/пара)

**❌ Проблема**: Лимит 15 позиций не освобождается
- **✅ Решение**: Детальное логирование закрытия позиций
- **✅ Решение**: Отслеживание освобождения слотов
- **⏳ В работе**: Требуется дальнейшее тестирование

### 8. **Следующие шаги оптимизации**

#### Высокий приоритет
- 🔍 **Диагностика лимита позиций**: Запуск длительного теста с новым логированием
- 🎮 **GPU поддержка**: Исследование возможности использования GPU для вычислений
- 📊 **Кэширование индикаторов**: Сохранение расчетов ATR/DLC для повторного использования

#### Средний приоритет  
- 🗄️ **Оптимизация БД**: Партиционирование таблицы свечей по времени
- 🌐 **CDN**: Настройка CDN для фронтенда
- 📈 **Мониторинг**: Grafana + Prometheus для отслеживания производительности

---

## 📞 Поддержка

При проблемах с производительностью:
1. Проверьте логи: `docker logs backtester-backend --tail 50`  
2. Проверьте ресурсы: `docker stats --no-stream`
3. Примените скрипт: `./scripts/apply_optimizations.sh` 