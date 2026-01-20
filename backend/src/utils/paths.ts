import path from 'path';
import fs from 'fs';
import logger from './logger';

/**
 * Определяет базовую директорию для хранения файлов в зависимости от среды
 */
export function getBaseDirectory(): string {
  // Если запущено в Docker, используем /app
  if (fs.existsSync('/app/dist')) {
    logger.debug('[Paths] Detected Docker environment, using /app');
    return '/app';
  }
  
  // Если запущено в разработке или в скомпилированном виде вне Docker
  if (process.env.NODE_ENV === 'production' && !fs.existsSync('/app/dist')) {
    // Скомпилированная версия, но не в Docker
    const prodPath = path.join(__dirname, '..', '..');
    logger.debug(`[Paths] Detected production environment (non-Docker), using ${prodPath}`);
    return prodPath;
  }
  
  // Режим разработки
  const devPath = path.join(__dirname, '..', '..');
  logger.debug(`[Paths] Detected development environment, using ${devPath}`);
  return devPath;
}

/**
 * Получает путь к директории для портфельных результатов
 */
export function getPortfolioResultsDirectory(): string {
  const baseDir = getBaseDirectory();
  const portfolioDir = path.join(baseDir, 'public', 'portfolio-results');
  logger.debug(`[Paths] Portfolio results directory: ${portfolioDir}`);
  return portfolioDir;
}

/**
 * Получает путь к файлу портфельного результата
 */
export function getPortfolioResultsFilePath(filename: string): string {
  const filepath = path.join(getPortfolioResultsDirectory(), filename);
  logger.debug(`[Paths] Portfolio results file path for ${filename}: ${filepath}`);
  return filepath;
}

/**
 * Создает директории если они не существуют
 */
export async function ensureDirectoriesExist(): Promise<void> {
  const portfolioDir = getPortfolioResultsDirectory();
  logger.info(`[Paths] Ensuring directory exists: ${portfolioDir}`);
  
  try {
    await fs.promises.mkdir(portfolioDir, { recursive: true });
    logger.info(`[Paths] Successfully created/verified directory: ${portfolioDir}`);
    
    // Проверяем доступность для записи
    await fs.promises.access(portfolioDir, fs.constants.W_OK);
    logger.info(`[Paths] Directory is writable: ${portfolioDir}`);
  } catch (error: any) {
    logger.error(`[Paths] Failed to create or access directory ${portfolioDir}:`, error);
    throw error;
  }
} 