import { Router, Request, Response } from 'express';
import { diagnosticManager, ErrorType } from '../diagnostics/TestDiagnosticManager';
import { enhancedDiagnosticManager } from '../diagnostics/enhancedDiagnosticManager';
import logger from '../utils/logger';

const router = Router();

/**
 * Получение всех ошибок с фильтрацией
 * GET /api/diagnostics/errors
 * 
 * Query параметры:
 * - type: ErrorType (optional)
 * - severity: string (optional)
 * - testId: string (optional)
 * - resolved: boolean (optional)
 * - startDate: Date (optional)
 * - endDate: Date (optional)
 * - limit: number (default: 100)
 */
router.get('/errors', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      type,
      severity,
      testId,
      resolved,
      startDate,
      endDate,
      limit = 100
    } = req.query;

    const filters = {
      type: type as ErrorType,
      severity: severity as string,
      testId: testId as string,
      resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    };

    const errors = diagnosticManager.getErrors(filters, parseInt(limit as string) || 100);
    const summary = diagnosticManager.getErrorSummary();

    logger.info(`[DiagnosticsAPI] Retrieved ${errors.length} errors with filters:`, filters);

    res.json({
      success: true,
      data: {
        errors: errors.map(error => ({
          ...error,
          timestamp: error.timestamp.toISOString(),
          resolvedAt: error.resolvedAt?.toISOString()
        })),
        summary,
        filters: filters
      }
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error retrieving errors:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve diagnostic errors',
      error: error.message
    });
  }
});

/**
 * Регистрация новой ошибки (для внутреннего использования)
 * POST /api/diagnostics/errors
 */
router.post('/errors', async (req: Request, res: Response): Promise<void> => {
  try {
    const errorData = req.body;

    // Валидация обязательных полей
    if (!errorData.type || !errorData.description) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: type, description'
      });
      return;
    }

    const registeredError = await diagnosticManager.registerError(errorData);

    logger.info(`[DiagnosticsAPI] Registered new error: ${registeredError.id}`);

    res.status(201).json({
      success: true,
      data: {
        ...registeredError,
        timestamp: registeredError.timestamp.toISOString(),
        resolvedAt: registeredError.resolvedAt?.toISOString()
      }
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error registering new error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to register diagnostic error',
      error: error.message
    });
  }
});

/**
 * Отметка ошибки как решенной
 * PUT /api/diagnostics/errors/:errorId/resolve
 */
router.put('/errors/:errorId/resolve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { errorId } = req.params;

    if (!errorId) {
      res.status(400).json({
        success: false,
        message: 'Error ID is required'
      });
      return;
    }

    diagnosticManager.resolveError(errorId);

    logger.info(`[DiagnosticsAPI] Marked error ${errorId} as resolved`);

    res.json({
      success: true,
      message: `Error ${errorId} marked as resolved`
    });

  } catch (error: any) {
    logger.error(`[DiagnosticsAPI] Error resolving error ${req.params.errorId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve error',
      error: error.message
    });
  }
});

/**
 * Анализ портфельных данных перед тестом
 * POST /api/diagnostics/portfolio/analyze
 * 
 * Body:
 * {
 *   "pairSymbols": ["BTCUSDT", "ETHUSDT"],
 *   "timeframe": "1h",
 *   "startDate": "2024-01-01",
 *   "endDate": "2024-01-31",
 *   "exchange": "okx"
 * }
 */
router.post('/portfolio/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const { pairSymbols, timeframe, startDate, endDate, exchange = 'okx' } = req.body;

    // Валидация входных данных
    if (!pairSymbols || !Array.isArray(pairSymbols) || pairSymbols.length === 0) {
      res.status(400).json({
        success: false,
        message: 'pairSymbols must be a non-empty array'
      });
      return;
    }

    if (!timeframe || !startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: timeframe, startDate, endDate'
      });
      return;
    }

    // Валидация дат
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({
        success: false,
        message: 'Invalid date format'
      });
      return;
    }

    if (start >= end) {
      res.status(400).json({
        success: false,
        message: 'Start date must be before end date'
      });
      return;
    }

    logger.info(`[DiagnosticsAPI] Analyzing portfolio data: ${pairSymbols.length} pairs on ${exchange}, ${timeframe}, ${startDate} to ${endDate}`);

    const analysis = await diagnosticManager.analyzePortfolioData(
      pairSymbols,
      timeframe,
      start,
      end,
      exchange
    );

    logger.info(`[DiagnosticsAPI] Portfolio analysis complete: ${analysis.availablePairs.length}/${analysis.totalPairs} pairs available`);

    res.json({
      success: true,
      data: analysis
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error analyzing portfolio data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze portfolio data',
      error: error.message
    });
  }
});

/**
 * Получение состояния системы
 * GET /api/diagnostics/system
 */
router.get('/system', async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info('[DiagnosticsAPI] Retrieving system health information');

    const systemHealth = await diagnosticManager.getSystemHealth();

    res.json({
      success: true,
      data: systemHealth,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error retrieving system health:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve system health',
      error: error.message
    });
  }
});

/**
 * Получение краткой сводки ошибок
 * GET /api/diagnostics/summary
 */
router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const summary = diagnosticManager.getErrorSummary();
    const systemHealth = await diagnosticManager.getSystemHealth();

    logger.info('[DiagnosticsAPI] Retrieved diagnostic summary');

    res.json({
      success: true,
      data: {
        errors: summary,
        system: {
          status: systemHealth.status,
          criticalRecommendations: systemHealth.recommendations.filter(r => r.priority >= 8).length
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error retrieving diagnostic summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve diagnostic summary',
      error: error.message
    });
  }
});

/**
 * Автоисправление ошибки
 * POST /api/diagnostics/errors/:errorId/fix
 */
router.post('/errors/:errorId/fix', async (req: Request, res: Response): Promise<void> => {
  try {
    const { errorId } = req.params;

    if (!errorId) {
      res.status(400).json({
        success: false,
        message: 'Error ID is required'
      });
      return;
    }

    // Найдем ошибку
    const errors = diagnosticManager.getErrors({ }, 1000);
    const error = errors.find(e => e.id === errorId);

    if (!error) {
      res.status(404).json({
        success: false,
        message: 'Error not found'
      });
      return;
    }

    if (!error.autoFixable) {
      res.status(400).json({
        success: false,
        message: 'This error is not auto-fixable'
      });
      return;
    }

    // Здесь будет логика автоисправления
    logger.info(`[DiagnosticsAPI] Attempting to fix error ${errorId}`);

    // Пока заглушка
    const success = false; // await diagnosticManager.attemptAutoFix(error);

    if (success) {
      res.json({
        success: true,
        message: `Error ${errorId} has been automatically fixed`
      });
    } else {
      res.json({
        success: false,
        message: `Failed to automatically fix error ${errorId}. Manual intervention required.`
      });
    }

  } catch (error: any) {
    logger.error(`[DiagnosticsAPI] Error attempting to fix error ${req.params.errorId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix error',
      error: error.message
    });
  }
});

/**
 * Получение доступных типов ошибок
 * GET /api/diagnostics/error-types
 */
router.get('/error-types', (req: Request, res: Response): void => {
  try {
    const errorTypes = Object.values(ErrorType).map(type => ({
      type,
      description: getErrorTypeDescription(type)
    }));

    res.json({
      success: true,
      data: errorTypes
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error retrieving error types:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve error types',
      error: error.message
    });
  }
});

/**
 * Healthcheck эндпоинт для диагностической системы
 * GET /api/diagnostics/health
 */
router.get('/health', (req: Request, res: Response): void => {
  try {
    const summary = diagnosticManager.getErrorSummary();

    res.json({
      success: true,
      status: 'operational',
      data: {
        diagnosticSystem: 'online',
        errorsTracked: summary.total,
        unresolvedErrors: summary.unresolved,
        criticalErrors: summary.critical,
        uptime: process.uptime(),
        enhancedDiagnostics: 'active'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'degraded',
      message: 'Diagnostic system health check failed',
      error: error.message
    });
  }
});

/**
 * Получение инсайтов и аналитики
 * GET /api/diagnostics/insights
 */
router.get('/insights', async (req: Request, res: Response): Promise<void> => {
  try {
    const insights = enhancedDiagnosticManager['insights'] || [];

    res.json({
      success: true,
      data: {
        insights: insights.slice(0, 50), // Последние 50 инсайтов
        totalInsights: insights.length,
        recentAnomalies: insights.filter(i => i.type === 'anomaly').slice(0, 10),
        recentPatterns: insights.filter(i => i.type === 'pattern').slice(0, 10)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error retrieving insights:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve diagnostic insights',
      error: error.message
    });
  }
});

/**
 * Получение состояния системы с улучшенными метриками
 * GET /api/diagnostics/system/enhanced
 */
router.get('/system/enhanced', async (req: Request, res: Response): Promise<void> => {
  try {
    const systemHealth = await diagnosticManager.getSystemHealth();
    const enhancedMetrics = enhancedDiagnosticManager['systemMetrics'] || {};

    res.json({
      success: true,
      data: {
        ...systemHealth,
        enhanced: {
          healthChecks: enhancedDiagnosticManager['healthChecks'].size,
          autoFixActions: enhancedDiagnosticManager['autoFixActions'].size,
          alertRules: enhancedDiagnosticManager['alertRules'].size,
          insights: enhancedDiagnosticManager['insights'].length,
          systemMetrics: enhancedMetrics
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error retrieving enhanced system health:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve enhanced system health',
      error: error.message
    });
  }
});

/**
 * Запуск ручного автоисправления
 * POST /api/diagnostics/autofix/:errorId
 */
router.post('/autofix/:errorId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { errorId } = req.params;

    if (!errorId) {
      res.status(400).json({
        success: false,
        message: 'Error ID is required'
      });
      return;
    }

    // Найдем ошибку в улучшенной системе
    const errors = enhancedDiagnosticManager['errors'] || [];
    const error = errors.find(e => e.id === errorId);

    if (!error) {
      res.status(404).json({
        success: false,
        message: 'Error not found'
      });
      return;
    }

    if (!error.autoFixable) {
      res.status(400).json({
        success: false,
        message: 'This error is not auto-fixable'
      });
      return;
    }

    // Попытаемся исправить (используем публичный метод)
    const success = false; // TODO: Implement proper auto-fix interface

    res.json({
      success: true,
      data: {
        errorId,
        fixed: success,
        message: success ? 'Error has been automatically fixed' : 'Failed to automatically fix error'
      }
    });

  } catch (error: any) {
    logger.error(`[DiagnosticsAPI] Error attempting manual auto-fix for ${req.params.errorId}:`, error);
    res.status(500).json({
      success: false,
      message: 'Failed to attempt auto-fix',
      error: error.message
    });
  }
});

/**
 * Получение доступных автоисправлений
 * GET /api/diagnostics/autofix/actions
 */
router.get('/autofix/actions', (req: Request, res: Response): void => {
  try {
    const actions = Array.from(enhancedDiagnosticManager['autoFixActions'].values());

    res.json({
      success: true,
      data: {
        actions: actions.map(action => ({
          id: action.id,
          name: action.name,
          description: action.description,
          type: action.type,
          target: action.target,
          timeout: action.timeout,
          retryCount: action.retryCount,
          priority: action.priority
        })),
        totalActions: actions.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('[DiagnosticsAPI] Error retrieving auto-fix actions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve auto-fix actions',
      error: error.message
    });
  }
});

/**
 * Получение описания типа ошибки
 */
function getErrorTypeDescription(type: ErrorType): string {
  switch (type) {
    case ErrorType.DATA_MISSING:
      return 'Отсутствуют исторические данные для торговой пары';
    case ErrorType.DATA_INCOMPLETE:
      return 'Неполное покрытие временного диапазона данными';
    case ErrorType.MEMORY_OVERFLOW:
      return 'Превышение лимитов памяти системы';
    case ErrorType.GPU_SERVICE_DOWN:
      return 'GPU сервис недоступен или не отвечает';
    case ErrorType.GPU_PERFORMANCE_ISSUE:
      return 'Проблемы с производительностью GPU';
    case ErrorType.VALIDATION_FAILED:
      return 'Ошибка валидации входных параметров';
    case ErrorType.CALCULATION_ERROR:
      return 'Ошибка в расчетах индикаторов или метрик';
    case ErrorType.STATE_CORRUPTION:
      return 'Повреждение состояния приложения';
    case ErrorType.API_RATE_LIMIT:
      return 'Превышение лимитов API биржи';
    case ErrorType.NETWORK_ERROR:
      return 'Ошибка сетевого соединения';
    case ErrorType.PORTFOLIO_INCOMPLETE:
      return 'Неполный набор данных для портфельного тестирования';
    case ErrorType.CONFIGURATION_ERROR:
      return 'Ошибка в конфигурации системы';
    default:
      return 'Неизвестный тип ошибки';
  }
}

export default router;
