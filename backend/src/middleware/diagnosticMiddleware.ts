import { Request, Response, NextFunction } from 'express';
import { diagnosticManager, ErrorType } from '../diagnostics/TestDiagnosticManager';
import { enhancedDiagnosticManager } from '../diagnostics/enhancedDiagnosticManager';
import logger from '../utils/logger';

/**
 * Middleware для автоматической регистрации ошибок в диагностической системе
 */
export const diagnosticErrorHandler = () => {
  return async (error: any, req: Request, res: Response, next: NextFunction) => {
    try {
      // Классификация ошибки
      const errorType = classifyError(error);
      const severity = calculateSeverity(error, errorType);
      
      // Регистрация в обеих диагностических системах
      const diagnosticError = await diagnosticManager.registerError({
        type: errorType,
        severity,
        testType: determineTestType(req.path),
        description: error.message || 'Unknown error occurred',
        context: {
          endpoint: req.path,
          method: req.method,
          body: req.body,
          params: req.params,
          query: req.query,
          userAgent: req.headers['user-agent'],
          ip: req.ip
        },
        stackTrace: error.stack,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] || 'unknown',
          errorCode: error.code,
          statusCode: error.statusCode || 500
        }
      });

      // Регистрируем в улучшенной системе
      await enhancedDiagnosticManager.registerEnhancedError({
        type: errorType,
        severity,
        testType: determineTestType(req.path),
        description: error.message || 'Unknown error occurred',
        context: {
          endpoint: req.path,
          method: req.method,
          body: req.body,
          params: req.params,
          query: req.query,
          userAgent: req.headers['user-agent'],
          ip: req.ip,
          correlationId: req.headers['x-request-id'] || 'unknown'
        },
        stackTrace: error.stack,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] || 'unknown',
          errorCode: error.code,
          statusCode: error.statusCode || 500
        },
        affectedComponents: ['api', 'middleware'],
        autoFixAttempts: 0
      });

      // Генерируем пользовательский ответ
      const userFriendlyError = generateUserFriendlyError(error, errorType);
      const suggestions = generateErrorSuggestions(errorType, error);

      logger.error(`[DiagnosticMiddleware] Error registered with ID: ${diagnosticError.id}`, {
        type: errorType,
        severity,
        endpoint: req.path
      });

      // Отправляем ответ пользователю
      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        error: {
          message: userFriendlyError.message,
          type: userFriendlyError.type,
          code: userFriendlyError.code
        },
        diagnosticId: diagnosticError.id,
        suggestions: suggestions,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && {
          debug: {
            originalError: error.message,
            stack: error.stack?.split('\n').slice(0, 5)
          }
        })
      });

    } catch (middlewareError: any) {
      logger.error('[DiagnosticMiddleware] Error in diagnostic middleware:', middlewareError);
      
      // Fallback - отправляем базовый ответ об ошибке
      res.status(500).json({
        success: false,
        error: {
          message: 'Internal server error',
          type: 'SYSTEM_ERROR',
          code: 'INTERNAL_ERROR'
        },
        timestamp: new Date().toISOString()
      });
    }
  };
};

/**
 * Классификация ошибки по типу
 */
function classifyError(error: any): ErrorType {
  // По коду ошибки
  if (error.code) {
    switch (error.code) {
      case 'ECONNREFUSED':
      case 'ETIMEDOUT':
      case 'ENOTFOUND':
        return ErrorType.NETWORK_ERROR;
      case 'ENOENT':
        return ErrorType.DATA_MISSING;
      case 'ENOMEM':
        return ErrorType.MEMORY_OVERFLOW;
    }
  }

  // По сообщению ошибки
  const message = error.message?.toLowerCase() || '';
  
  if (message.includes('no data') || message.includes('not found')) {
    return ErrorType.DATA_MISSING;
  }
  
  if (message.includes('memory') || message.includes('heap') || message.includes('out of memory')) {
    return ErrorType.MEMORY_OVERFLOW;
  }
  
  if (message.includes('gpu') || message.includes('cuda')) {
    return ErrorType.GPU_SERVICE_DOWN;
  }
  
  if (message.includes('validation') || message.includes('invalid')) {
    return ErrorType.VALIDATION_FAILED;
  }
  
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return ErrorType.API_RATE_LIMIT;
  }
  
  if (message.includes('network') || message.includes('connection')) {
    return ErrorType.NETWORK_ERROR;
  }
  
  if (message.includes('calculation') || message.includes('computation')) {
    return ErrorType.CALCULATION_ERROR;
  }

  // По статус коду HTTP
  if (error.statusCode) {
    switch (error.statusCode) {
      case 400:
        return ErrorType.VALIDATION_FAILED;
      case 404:
        return ErrorType.DATA_MISSING;
      case 429:
        return ErrorType.API_RATE_LIMIT;
      case 503:
        return ErrorType.GPU_SERVICE_DOWN;
    }
  }

  // По умолчанию
  return ErrorType.CALCULATION_ERROR;
}

/**
 * Расчет серьезности ошибки
 */
function calculateSeverity(error: any, errorType: ErrorType): 'low' | 'medium' | 'high' | 'critical' {
  // Критические ошибки
  if (errorType === ErrorType.MEMORY_OVERFLOW || 
      errorType === ErrorType.GPU_SERVICE_DOWN ||
      error.statusCode >= 500) {
    return 'critical';
  }

  // Высокая важность
  if (errorType === ErrorType.DATA_MISSING ||
      errorType === ErrorType.PORTFOLIO_INCOMPLETE ||
      error.statusCode >= 400) {
    return 'high';
  }

  // Средняя важность
  if (errorType === ErrorType.DATA_INCOMPLETE ||
      errorType === ErrorType.VALIDATION_FAILED ||
      errorType === ErrorType.API_RATE_LIMIT) {
    return 'medium';
  }

  // Низкая важность
  return 'low';
}

/**
 * Определение типа теста по пути запроса
 */
function determineTestType(path: string): 'single' | 'portfolio' | 'gpu' | 'system' {
  if (path.includes('portfolio')) {
    return 'portfolio';
  } else if (path.includes('gpu')) {
    return 'gpu';
  } else if (path.includes('backtest')) {
    return 'single';
  } else {
    return 'system';
  }
}

/**
 * Генерация пользовательского описания ошибки
 */
function generateUserFriendlyError(error: any, errorType: ErrorType): {
  message: string;
  type: string;
  code: string;
} {
  switch (errorType) {
    case ErrorType.DATA_MISSING:
      return {
        message: 'Отсутствуют необходимые исторические данные. Пожалуйста, загрузите данные для выбранных торговых пар.',
        type: 'DATA_ERROR',
        code: 'MISSING_DATA'
      };

    case ErrorType.DATA_INCOMPLETE:
      return {
        message: 'Данные неполные для указанного временного периода. Рекомендуется дозагрузить недостающие данные.',
        type: 'DATA_ERROR', 
        code: 'INCOMPLETE_DATA'
      };

    case ErrorType.MEMORY_OVERFLOW:
      return {
        message: 'Недостаточно памяти для обработки запроса. Попробуйте уменьшить количество торговых пар или временной период.',
        type: 'RESOURCE_ERROR',
        code: 'MEMORY_LIMIT'
      };

    case ErrorType.GPU_SERVICE_DOWN:
      return {
        message: 'GPU сервис временно недоступен. Система автоматически переключилась на CPU обработку.',
        type: 'SERVICE_ERROR',
        code: 'GPU_UNAVAILABLE'
      };

    case ErrorType.VALIDATION_FAILED:
      return {
        message: 'Некорректные параметры запроса. Пожалуйста, проверьте введенные данные.',
        type: 'VALIDATION_ERROR',
        code: 'INVALID_INPUT'
      };

    case ErrorType.API_RATE_LIMIT:
      return {
        message: 'Превышен лимит запросов к API биржи. Повторите попытку через несколько минут.',
        type: 'RATE_LIMIT_ERROR',
        code: 'TOO_MANY_REQUESTS'
      };

    case ErrorType.NETWORK_ERROR:
      return {
        message: 'Проблема с сетевым соединением. Проверьте подключение к интернету и повторите попытку.',
        type: 'NETWORK_ERROR',
        code: 'CONNECTION_FAILED'
      };

    case ErrorType.CALCULATION_ERROR:
      return {
        message: 'Ошибка в расчетах. Пожалуйста, проверьте корректность параметров стратегии.',
        type: 'CALCULATION_ERROR',
        code: 'COMPUTATION_FAILED'
      };

    default:
      return {
        message: 'Произошла внутренняя ошибка сервера. Пожалуйста, повторите попытку позже.',
        type: 'SYSTEM_ERROR',
        code: 'INTERNAL_ERROR'
      };
  }
}

/**
 * Генерация предложений по исправлению ошибки
 */
function generateErrorSuggestions(errorType: ErrorType, error: any): Array<{
  action: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
}> {
  const suggestions: Array<{ action: string; description: string; priority: 'low' | 'medium' | 'high' }> = [];

  switch (errorType) {
    case ErrorType.DATA_MISSING:
      suggestions.push({
        action: 'FETCH_DATA',
        description: 'Загрузить недостающие исторические данные',
        priority: 'high'
      });
      suggestions.push({
        action: 'REDUCE_PAIRS',
        description: 'Уменьшить количество торговых пар',
        priority: 'medium'
      });
      break;

    case ErrorType.MEMORY_OVERFLOW:
      suggestions.push({
        action: 'REDUCE_DATA_SIZE',
        description: 'Уменьшить объем обрабатываемых данных',
        priority: 'high'
      });
      suggestions.push({
        action: 'SPLIT_REQUEST',
        description: 'Разделить запрос на несколько меньших частей',
        priority: 'high'
      });
      break;

    case ErrorType.GPU_SERVICE_DOWN:
      suggestions.push({
        action: 'USE_CPU_MODE',
        description: 'Переключиться на CPU режим',
        priority: 'high'
      });
      suggestions.push({
        action: 'RESTART_GPU_SERVICE',
        description: 'Перезапустить GPU сервис (требует админских прав)',
        priority: 'medium'
      });
      break;

    case ErrorType.API_RATE_LIMIT:
      suggestions.push({
        action: 'RETRY_LATER',
        description: 'Повторить запрос через 5-10 минут',
        priority: 'high'
      });
      suggestions.push({
        action: 'REDUCE_CONCURRENCY',
        description: 'Снизить интенсивность запросов',
        priority: 'medium'
      });
      break;

    case ErrorType.VALIDATION_FAILED:
      suggestions.push({
        action: 'CHECK_PARAMETERS',
        description: 'Проверить корректность всех параметров',
        priority: 'high'
      });
      suggestions.push({
        action: 'USE_DEFAULT_VALUES',
        description: 'Использовать параметры по умолчанию',
        priority: 'medium'
      });
      break;

    default:
      suggestions.push({
        action: 'RETRY_REQUEST',
        description: 'Повторить запрос',
        priority: 'medium'
      });
      suggestions.push({
        action: 'CHECK_LOGS',
        description: 'Проверить логи для дополнительной информации',
        priority: 'low'
      });
      break;
  }

  return suggestions;
}

/**
 * Middleware для логирования запросов (опционально)
 */
export const diagnosticRequestLogger = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    // Перехватываем конец ответа
    const originalSend = res.send;
    res.send = function(data) {
      const duration = Date.now() - startTime;
      
      // Логируем медленные запросы
      if (duration > 5000) { // 5 секунд
        logger.warn('[DiagnosticMiddleware] Slow request detected', {
          method: req.method,
          path: req.path,
          duration: `${duration}ms`,
          statusCode: res.statusCode
        });
        
        // Можем зарегистрировать как проблему производительности
        if (duration > 30000) { // 30 секунд
          diagnosticManager.registerError({
            type: ErrorType.CALCULATION_ERROR,
            severity: 'medium',
            testType: determineTestType(req.path),
            description: `Slow request: ${req.method} ${req.path} took ${duration}ms`,
            context: {
              endpoint: req.path,
              method: req.method,
              duration,
              statusCode: res.statusCode
            }
          });
        }
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

