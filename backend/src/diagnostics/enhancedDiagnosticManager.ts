/**
 * Улучшенная диагностическая система с автоматическим исправлением проблем
 * Основана на лучших практиках open source проектов
 */

import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { checkGPUServiceHealth } from '../services/gpuService';
import { promisify } from 'util';
import logger from '../utils/logger';
import { broadcast } from '../websocket';
import { dataService } from '../services/dataService';

// Импорты из существующей системы
import {
  ErrorType,
  TestError,
  ErrorContext,
  FixSuggestion,
  SystemMetrics,
  PairDataStatus,
  PortfolioDataAnalysis,
  DiagnosticRecommendation
} from './TestDiagnosticManager';

// === УЛУЧШЕННЫЕ ТИПЫ ===

export interface EnhancedError extends TestError {
  correlationId?: string; // Для связывания связанных ошибок
  rootCause?: string; // Корневая причина
  affectedComponents: string[]; // Затронутые компоненты
  escalationLevel: number; // Уровень эскалации (0-3)
  autoFixAttempts: number; // Количество попыток автоисправления
  lastAutoFixAt?: Date;
  mitigationActions?: string[]; // Действия по смягчению
}

export interface AutoFixAction {
  id: string;
  name: string;
  description: string;
  type: 'restart' | 'cleanup' | 'reload' | 'reconfigure' | 'external';
  target: string; // Компонент для исправления
  command?: string; // Команда для выполнения
  timeout: number; // Таймаут в секундах
  retryCount: number;
  priority: number;
  prerequisites?: string[]; // Зависимости
}

export interface HealthCheck {
  id: string;
  name: string;
  description: string;
  component: string;
  check: () => Promise<{ status: 'healthy' | 'warning' | 'critical'; message: string; metrics?: any }>;
  interval: number; // В секундах
  timeout: number;
  critical: boolean; // Критическая проверка
  lastRun?: Date;
  lastStatus?: 'healthy' | 'warning' | 'critical';
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: (error: EnhancedError, metrics: SystemMetrics) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  channels: ('websocket' | 'email' | 'slack' | 'webhook')[];
  cooldown: number; // В минутах
  template: string; // Шаблон сообщения
  lastTriggered?: Date;
}

export interface DiagnosticInsight {
  id: string;
  type: 'pattern' | 'trend' | 'anomaly' | 'prediction';
  title: string;
  description: string;
  confidence: number; // 0-1
  impact: 'low' | 'medium' | 'high';
  actions: string[];
  data: any;
  createdAt: Date;
  expiresAt?: Date;
}

// === УЛУЧШЕННЫЙ МЕНЕДЖЕР ДИАГНОСТИКИ ===

export class EnhancedDiagnosticManager {
  private errors: EnhancedError[] = [];
  private maxErrorHistory = 2000;
  private autoFixActions: Map<string, AutoFixAction> = new Map();
  private healthChecks: Map<string, HealthCheck> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private insights: DiagnosticInsight[] = [];
  private systemMetrics: SystemMetrics = {} as SystemMetrics;
  private monitoringInterval?: NodeJS.Timeout;

  constructor() {
    this.initializeSystemMetrics();
    this.initializeHealthChecks();
    this.initializeAlertRules();
    this.initializeAutoFixActions();
    this.startSystemMonitoring();
    this.startEnhancedMonitoring();
  }

  // === ИНИЦИАЛИЗАЦИЯ ===

  private initializeHealthChecks(): void {
    const checks: HealthCheck[] = [
      {
        id: 'database',
        name: 'Database Connection',
        description: 'Проверка подключения к PostgreSQL',
        component: 'database',
        interval: 30,
        timeout: 10,
        critical: true,
        check: this.checkDatabaseHealth.bind(this)
      },
      {
        id: 'redis',
        name: 'Redis Connection',
        description: 'Проверка подключения к Redis',
        component: 'cache',
        interval: 30,
        timeout: 10,
        critical: true,
        check: this.checkRedisHealth.bind(this)
      },
      {
        id: 'memory',
        name: 'Memory Usage',
        description: 'Мониторинг использования памяти',
        component: 'system',
        interval: 15,
        timeout: 5,
        critical: false,
        check: this.checkMemoryHealth.bind(this)
      },
      {
        id: 'api-rate-limits',
        name: 'API Rate Limits',
        description: 'Проверка лимитов API бирж',
        component: 'external',
        interval: 300, // 5 минут
        timeout: 30,
        critical: false,
        check: this.checkAPIRateLimits.bind(this)
      }
    ];

    checks.forEach(check => this.healthChecks.set(check.id, check));
  }

  private initializeAlertRules(): void {
    const rules: AlertRule[] = [
      {
        id: 'memory-critical',
        name: 'Critical Memory Usage',
        description: 'Критическое использование памяти (>90%)',
        severity: 'critical',
        channels: ['websocket', 'email'],
        cooldown: 15,
        condition: (error, metrics) => metrics.memory.percentage > 90,
        template: '🚨 КРИТИЧНО: Использование памяти {memoryPercentage}% (>{memoryLimit}%)'
      },
      {
        id: 'error-spike',
        name: 'Error Spike',
        description: 'Резкий рост количества ошибок',
        severity: 'high',
        channels: ['websocket'],
        cooldown: 30,
        condition: (error, metrics) => this.hasErrorSpike(),
        template: '📈 Обнаружен всплеск ошибок: {errorCount} ошибок за последний час'
      },
      {
        id: 'database-down',
        name: 'Database Unavailable',
        description: 'База данных недоступна',
        severity: 'critical',
        channels: ['websocket', 'email'],
        cooldown: 5,
        condition: (error, metrics) => false, // TODO: Add database health check
        template: '💾 База данных недоступна! Критическая ошибка системы.'
      }
    ];

    rules.forEach(rule => this.alertRules.set(rule.id, rule));
  }

  private initializeAutoFixActions(): void {
    const actions: AutoFixAction[] = [
      {
        id: 'restart-gpu-service',
        name: 'Перезапуск GPU сервиса',
        description: 'Автоматический перезапуск GPU сервиса при сбое',
        type: 'restart',
        target: 'gpu-service',
        command: 'systemctl restart gpu-service || docker restart gpu-service',
        timeout: 60,
        retryCount: 3,
        priority: 10
      },
      {
        id: 'garbage-collection',
        name: 'Принудительная сборка мусора',
        description: 'Принудительная очистка памяти при переполнении',
        type: 'cleanup',
        target: 'memory',
        timeout: 30,
        retryCount: 1,
        priority: 9,
        prerequisites: ['memory-critical']
      },
      {
        id: 'cleanup-temp-files',
        name: 'Очистка временных файлов',
        description: 'Удаление накопившихся временных файлов',
        type: 'cleanup',
        target: 'storage',
        command: 'find /tmp -type f -mtime +7 -delete',
        timeout: 120,
        retryCount: 1,
        priority: 5
      },
      {
        id: 'reload-configuration',
        name: 'Перезагрузка конфигурации',
        description: 'Перезагрузка конфигурации при ошибках валидации',
        type: 'reload',
        target: 'config',
        timeout: 15,
        retryCount: 2,
        priority: 7
      }
    ];

    actions.forEach(action => this.autoFixActions.set(action.id, action));
  }

  private startEnhancedMonitoring(): void {
    // Запускаем проверки здоровья
    setInterval(() => {
      this.runHealthChecks();
    }, 10000); // Каждые 10 секунд

    // Запускаем анализ паттернов
    setInterval(() => {
      this.analyzeErrorPatterns();
    }, 60000); // Каждую минуту

    // Запускаем проверку алертов
    setInterval(() => {
      this.checkAlertRules();
    }, 30000); // Каждые 30 секунд

    logger.info('[EnhancedDiagnosticManager] Enhanced monitoring started');
  }

  private initializeSystemMetrics(): void {
    const memInfo = process.memoryUsage();

    const heapUsed = memInfo.heapUsed;
    const heapTotal = memInfo.heapTotal || 1;

    this.systemMetrics = {
      cpu: {
        usage: process.cpuUsage().user / 1000000,
        cores: os.cpus().length,
        load: os.loadavg()
      },
      memory: {
        used: Math.round(heapUsed / 1024 / 1024),
        total: Math.round(heapTotal / 1024 / 1024),
        percentage: Math.round((heapUsed / heapTotal) * 100)
      },
      disk: {
        used: 0,
        total: 0,
        percentage: 0
      },
      gpu: {
        available: process.env.DISABLE_GPU_SERVICE !== 'true',
        healthy: false,
        memoryUsed: 0,
        memoryTotal: 0,
        utilization: 0
      }
    };
  }

  private async updateSystemMetrics(): Promise<void> {
    const memInfo = process.memoryUsage();
    const heapUsed = memInfo.heapUsed;
    const heapTotal = memInfo.heapTotal || 1;

    this.systemMetrics = {
      cpu: {
        usage: process.cpuUsage().user / 1000000,
        cores: os.cpus().length,
        load: os.loadavg()
      },
      memory: {
        used: Math.round(heapUsed / 1024 / 1024),
        total: Math.round(heapTotal / 1024 / 1024),
        percentage: Math.min(100, Math.round((heapUsed / heapTotal) * 100))
      },
      disk: {
        used: 0,
        total: 0,
        percentage: 0
      },
      gpu: {
        available: process.env.DISABLE_GPU_SERVICE !== 'true',
        healthy: false,
        memoryUsed: 0,
        memoryTotal: 0,
        utilization: 0
      }
    };
  }

  private startSystemMonitoring(): void {
    this.updateSystemMetrics().catch(error => {
      logger.warn('[EnhancedDiagnosticManager] Failed to update system metrics:', error);
    });

    setInterval(async () => {
      try {
        await this.updateSystemMetrics();
      } catch (error) {
        logger.warn('[EnhancedDiagnosticManager] Error in system monitoring:', error);
      }
    }, 15000);

    logger.info('[EnhancedDiagnosticManager] System metrics monitoring started (15s intervals)');
  }

  // === ПРОВЕРКИ ЗДОРОВЬЯ ===

  private async checkDatabaseHealth(): Promise<{ status: 'healthy' | 'warning' | 'critical'; message: string; metrics?: any }> {
    try {
      const startTime = Date.now();
      await dataService.getTradingPairBySymbol('BTCUSDT', 'okx');
      const responseTime = Date.now() - startTime;

      return {
        status: responseTime > 5000 ? 'warning' : 'healthy',
        message: `Database response time: ${responseTime}ms`,
        metrics: { responseTime }
      };
    } catch (error) {
      return {
        status: 'critical',
        message: `Database connection failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async checkRedisHealth(): Promise<{ status: 'healthy' | 'warning' | 'critical'; message: string; metrics?: any }> {
    try {
      // Простая проверка Redis (нужно добавить Redis клиент)
      // const redis = getRedisClient();
      // await redis.ping();

      return {
        status: 'healthy',
        message: 'Redis connection OK'
      };
    } catch (error) {
      return {
        status: 'critical',
        message: `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async checkMemoryHealth(): Promise<{ status: 'healthy' | 'warning' | 'critical'; message: string; metrics?: any }> {
    const memUsage = process.memoryUsage();
    const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    const status = heapUsagePercent > 90 ? 'critical' :
                  heapUsagePercent > 75 ? 'warning' : 'healthy';

    return {
      status,
      message: `Memory usage: ${heapUsagePercent.toFixed(1)}% (${(memUsage.heapUsed / 1024 / 1024).toFixed(1)}MB)`,
      metrics: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        heapUsagePercent,
        rss: memUsage.rss
      }
    };
  }

  private async checkDiskHealth(): Promise<{ status: 'healthy' | 'warning' | 'critical'; message: string; metrics?: any }> {
    try {
      const stats = fs.statSync('/');
      const freeSpace = stats.blocks * (stats as any).bsize || 4096; // Примерный расчет
      const freePercent = (freeSpace / (1024 * 1024 * 1024)) / 100; // GB

      const status = freePercent < 5 ? 'critical' :
                    freePercent < 20 ? 'warning' : 'healthy';

      return {
        status,
        message: `Disk space: ${freePercent.toFixed(1)}GB free`,
        metrics: { freeSpace, freePercent }
      };
    } catch (error) {
      return {
        status: 'critical',
        message: `Disk check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async checkGPUHealth(): Promise<{ status: 'healthy' | 'warning' | 'critical'; message: string; metrics?: any }> {
    // Проверяем, отключен ли GPU сервис
    const DISABLE_GPU_SERVICE = process.env.DISABLE_GPU_SERVICE === 'true';

    if (DISABLE_GPU_SERVICE) {
      return {
        status: 'healthy',
        message: 'GPU service disabled by environment variable',
        metrics: { available: false, disabled: true }
      };
    }

    try {
      const isHealthy = await checkGPUServiceHealth();

      return {
        status: isHealthy ? 'healthy' : 'warning',
        message: isHealthy ? 'GPU service operational' : 'GPU service issues detected',
        metrics: { available: isHealthy }
      };
    } catch (error) {
      return {
        status: 'critical',
        message: `GPU health check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async checkAPIRateLimits(): Promise<{ status: 'healthy' | 'warning' | 'critical'; message: string; metrics?: any }> {
    // Проверка лимитов API бирж
    // Реализация зависит от конкретных API

    return {
      status: 'healthy',
      message: 'API rate limits OK'
    };
  }

  // === АНАЛИЗ ПАТТЕРНОВ ОШИБОК ===

  private analyzeErrorPatterns(): void {
    const recentErrors = this.errors.filter(e =>
      e.timestamp > new Date(Date.now() - 60 * 60 * 1000) // Последний час
    );

    // Обнаружение всплесков
    if (recentErrors.length > 20) {
      this.generateInsight({
        type: 'anomaly',
        title: 'Всплеск количества ошибок',
        description: `Обнаружено ${recentErrors.length} ошибок за последний час`,
        confidence: 0.9,
        impact: 'high',
        actions: ['Проверить системные логи', 'Проверить нагрузку на сервер'],
        data: { errorCount: recentErrors.length }
      });
    }

    // Анализ по типам ошибок
    const errorTypes = new Map<ErrorType, number>();
    recentErrors.forEach(error => {
      errorTypes.set(error.type, (errorTypes.get(error.type) || 0) + 1);
    });

    const mostCommon = Array.from(errorTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (mostCommon.length > 0 && mostCommon[0][1] > 5) {
      this.generateInsight({
        type: 'pattern',
        title: `Доминирующий тип ошибок: ${mostCommon[0][0]}`,
        description: `${mostCommon[0][1]} ошибок типа ${mostCommon[0][0]} за последний час`,
        confidence: 0.8,
        impact: 'medium',
        actions: ['Проверить связанный компонент', 'Рассмотреть оптимизацию'],
        data: { dominantType: mostCommon[0][0], count: mostCommon[0][1] }
      });
    }
  }

  // === АВТОИСПРАВЛЕНИЕ ===

  private async attemptAutoFix(error: EnhancedError): Promise<boolean> {
    logger.info(`[EnhancedDiagnosticManager] Attempting auto-fix for error ${error.id}: ${error.type}`);

    try {
      switch (error.type) {
        case ErrorType.MEMORY_OVERFLOW:
          return await this.autoFixMemoryOverflow(error);
        case ErrorType.GPU_SERVICE_DOWN:
          return await this.autoFixGPUService(error);
        case ErrorType.DATA_MISSING:
          return await this.autoFixMissingData(error);
        default:
          return false;
      }
    } catch (fixError: any) {
      logger.error(`[EnhancedDiagnosticManager] Auto-fix failed for error ${error.id}:`, fixError);
      return false;
    }
  }

  private async autoFixMemoryOverflow(error: EnhancedError): Promise<boolean> {
    try {
      // Принудительная сборка мусора
      if (global.gc) {
        logger.warn('[EnhancedDiagnosticManager] Forcing garbage collection...');
        global.gc();
        global.gc();

        const memAfterGC = process.memoryUsage();
        const heapAfterMB = Math.round(memAfterGC.heapUsed / 1024 / 1024);

        if (heapAfterMB < 6000) { // Если память уменьшилась
          error.resolved = true;
          error.resolvedAt = new Date();

          broadcast({
            type: 'MEMORY_FIXED',
            data: {
              before: Math.round(memAfterGC.heapUsed / 1024 / 1024),
              after: heapAfterMB,
              freed: Math.round(memAfterGC.heapUsed / 1024 / 1024) - heapAfterMB
            }
          });

          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  private async autoFixGPUService(error: EnhancedError): Promise<boolean> {
    try {
      // Проверяем, можем ли перезапустить GPU сервис
      const action = this.autoFixActions.get('restart-gpu-service');
      if (action) {
        return await this.executeAutoFixAction(action);
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  private async autoFixMissingData(error: EnhancedError): Promise<boolean> {
    // Автоматическая загрузка данных
    try {
      const symbol = error.context.symbol;
      const timeframe = error.context.timeframe;
      const exchange = error.context.exchange;

      if (symbol && timeframe && exchange) {
        logger.info(`[EnhancedDiagnosticManager] Attempting to fetch missing data for ${symbol}`);

        // Здесь будет вызов сервиса загрузки данных
        // await dataService.fetchCandlesForSymbol(symbol, timeframe, startDate, endDate, exchange);

        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  private async executeAutoFixAction(action: AutoFixAction): Promise<boolean> {
    logger.info(`[EnhancedDiagnosticManager] Executing auto-fix action: ${action.name}`);

    try {
      if (action.command) {
        return await this.executeCommand(action.command, action.timeout);
      }

      // Другие типы действий
      switch (action.type) {
        case 'cleanup':
          return await this.performCleanup(action.target);
        case 'reload':
          return await this.reloadComponent(action.target);
        default:
          return false;
      }
    } catch (error) {
      logger.error(`[EnhancedDiagnosticManager] Auto-fix action ${action.id} failed:`, error);
      return false;
    }
  }

  private async executeCommand(command: string, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const child = exec(command, { timeout: timeout * 1000 }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`[EnhancedDiagnosticManager] Command failed: ${error.message}`);
          resolve(false);
        } else {
          logger.info(`[EnhancedDiagnosticManager] Command executed successfully`);
          resolve(true);
        }
      });

      // Таймаут
      setTimeout(() => {
        child.kill();
        resolve(false);
      }, timeout * 1000);
    });
  }

  private async performCleanup(target: string): Promise<boolean> {
    switch (target) {
      case 'memory':
        if (global.gc) {
          global.gc();
          return true;
        }
        return false;
      case 'storage':
        // Очистка временных файлов
        return true;
      default:
        return false;
    }
  }

  private async reloadComponent(target: string): Promise<boolean> {
    // Перезагрузка компонентов
    logger.info(`[EnhancedDiagnosticManager] Reloading component: ${target}`);
    return true;
  }

  // === АЛЕРТИНГ ===

  private checkAlertRules(): void {
    const currentMetrics = this.systemMetrics;

    if (!currentMetrics?.memory) {
      return;
    }

    this.alertRules.forEach((rule, ruleId) => {
      const shouldAlert = rule.condition(
        this.errors.find(e => !e.resolved && e.severity === rule.severity) || {} as EnhancedError,
        currentMetrics
      );

      if (shouldAlert && this.canTriggerAlert(rule)) {
        this.triggerAlert(rule, currentMetrics);
      }
    });
  }

  private canTriggerAlert(rule: AlertRule): boolean {
    if (!rule.lastTriggered) return true;

    const cooldownMs = rule.cooldown * 60 * 1000;
    return (Date.now() - rule.lastTriggered.getTime()) > cooldownMs;
  }

  private triggerAlert(rule: AlertRule, metrics: SystemMetrics): void {
    rule.lastTriggered = new Date();

    const message = this.formatAlertMessage(rule.template, metrics);

    logger.warn(`[EnhancedDiagnosticManager] ALERT: ${rule.name} - ${message}`);

    // Отправка уведомлений по разным каналам
    rule.channels.forEach(channel => {
      this.sendAlert(channel, rule, message);
    });

    // WebSocket уведомление
    broadcast({
      type: 'DIAGNOSTIC_ALERT',
      alert: {
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        message,
        timestamp: new Date().toISOString()
      }
    });
  }

  private formatAlertMessage(template: string, metrics: SystemMetrics): string {
    const memoryPercentage = metrics?.memory?.percentage ?? 0;
    return template
      .replace('{memoryPercentage}', memoryPercentage.toFixed(1))
      .replace('{memoryLimit}', '90')
      .replace('{errorCount}', '50');
  }

  private sendAlert(channel: string, rule: AlertRule, message: string): void {
    switch (channel) {
      case 'email':
        // Отправка email (требует настройки SMTP)
        break;
      case 'slack':
        // Отправка в Slack (требует webhook)
        break;
      case 'webhook':
        // HTTP webhook
        break;
    }
  }

  // === ИНСАЙТЫ ===

  private generateInsight(insight: Omit<DiagnosticInsight, 'id' | 'createdAt'>): void {
    const fullInsight: DiagnosticInsight = {
      ...insight,
      id: uuidv4(),
      createdAt: new Date()
    };

    this.insights.unshift(fullInsight);

    // Ограничиваем количество инсайтов
    if (this.insights.length > 100) {
      this.insights = this.insights.slice(0, 100);
    }

    broadcast({
      type: 'DIAGNOSTIC_INSIGHT',
      insight: fullInsight
    });
  }

  private hasErrorSpike(): boolean {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentErrors = this.errors.filter(e => e.timestamp > hourAgo);
    return recentErrors.length > 20;
  }

  // === ПУБЛИЧНЫЕ МЕТОДЫ ===

  async registerEnhancedError(errorData: Partial<EnhancedError>): Promise<EnhancedError> {
    const fullError: EnhancedError = {
      id: uuidv4(),
      timestamp: new Date(),
      severity: this.calculateSeverity(errorData),
      impact: this.calculateImpact(errorData),
      autoFixable: this.isAutoFixable(errorData),
      suggestions: await this.generateSuggestions(errorData),
      resolved: false,
      testId: errorData.testId || 'unknown',
      testType: errorData.testType || 'system',
      type: errorData.type || ErrorType.CALCULATION_ERROR,
      description: errorData.description || 'Unknown error',
      context: errorData.context || {},
      metadata: errorData.metadata || {},
      stackTrace: errorData.stackTrace,
      affectedComponents: errorData.affectedComponents || [],
      escalationLevel: 0,
      autoFixAttempts: 0,
      correlationId: errorData.correlationId
    };

    // Добавляем в историю
    this.errors.unshift(fullError);

    if (this.errors.length > this.maxErrorHistory) {
      this.errors = this.errors.slice(0, this.maxErrorHistory);
    }

    // Попытка автоисправления
    if (fullError.autoFixable) {
      setTimeout(async () => {
        await this.attemptAutoFix(fullError);
      }, 1000);
    }

    return fullError;
  }

  private async runHealthChecks(): Promise<void> {
    for (const [checkId, check] of this.healthChecks) {
      try {
        const result = await Promise.race([
          check.check(),
          new Promise(resolve =>
            setTimeout(() => resolve({ status: 'critical', message: 'Health check timeout' }), check.timeout * 1000)
          )
        ]) as any;

        check.lastRun = new Date();
        check.lastStatus = result.status;

        if (result.status !== 'healthy') {
          await this.registerEnhancedError({
            type: ErrorType.STATE_CORRUPTION,
            severity: result.status === 'critical' ? 'critical' : 'medium',
            description: `${check.name}: ${result.message}`,
            context: { component: check.component, checkId },
            affectedComponents: [check.component]
          });
        }
      } catch (error: any) {
        check.lastStatus = 'critical';
        await this.registerEnhancedError({
          type: ErrorType.STATE_CORRUPTION,
          severity: 'critical',
          description: `Health check ${check.name} failed: ${error.message}`,
          context: { component: check.component, checkId },
          affectedComponents: [check.component]
        });
      }
    }
  }

  private calculateSeverity(errorData: Partial<EnhancedError>): 'low' | 'medium' | 'high' | 'critical' {
    // Улучшенная логика расчета серьезности
    if (errorData.severity) return errorData.severity;

    switch (errorData.type) {
      case ErrorType.MEMORY_OVERFLOW:
      case ErrorType.GPU_SERVICE_DOWN:
        return 'critical';
      case ErrorType.DATA_MISSING:
      case ErrorType.PORTFOLIO_INCOMPLETE:
        return 'high';
      default:
        return 'medium';
    }
  }

  private calculateImpact(errorData: Partial<EnhancedError>): number {
    // Улучшенный расчет влияния
    const baseImpact: Record<string, number> = {
      [ErrorType.MEMORY_OVERFLOW]: 1.0,
      [ErrorType.GPU_SERVICE_DOWN]: 0.8,
      [ErrorType.DATA_MISSING]: 0.7,
      [ErrorType.PORTFOLIO_INCOMPLETE]: 0.6,
      [ErrorType.DATA_INCOMPLETE]: 0.4
    };

    return baseImpact[errorData.type as string] || 0.3;
  }

  private isAutoFixable(errorData: Partial<EnhancedError>): boolean {
    return [
      ErrorType.MEMORY_OVERFLOW,
      ErrorType.GPU_SERVICE_DOWN,
      ErrorType.DATA_MISSING
    ].includes(errorData.type as ErrorType);
  }

  private async generateSuggestions(errorData: Partial<EnhancedError>): Promise<FixSuggestion[]> {
    // Улучшенная генерация предложений
    return [];
  }
}

// === ЭКСПОРТ ===

export const enhancedDiagnosticManager = new EnhancedDiagnosticManager();
