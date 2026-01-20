import fs from 'fs';
import logger from './logger';
import { getPortfolioResultsDirectory, getPortfolioResultsFilePath } from './paths';
import type { PortfolioBacktestResult, PortfolioBacktestRunParameters } from '@/modules/backtester/backtester.types';

export interface PortfolioResultSaveOptions {
  jobId?: string | number;
  timestamp?: number;
  prefix?: string;
  serializedResult?: string;
  portfolioParams?: PortfolioBacktestRunParameters;
}

export interface PortfolioResultSaveMetadata {
  filename: string;
  filepath: string;
  downloadUrl: string;
  sizeBytes: number;
  sizeMB: number;
}

function buildFilename(
  result: PortfolioBacktestResult,
  options: PortfolioResultSaveOptions
): { filename: string; dateLabel: string; pnlLabel: string } {
  const jobPart = options.jobId !== undefined ? String(options.jobId) : 'manual';
  const timestamp = options.timestamp ?? Date.now();

  const now = new Date(timestamp);
  const dateLabel = now.toISOString().split('T')[0].replace(/[^0-9-]/g, '');

  const pnlRaw = Number(result?.overallMetrics?.totalPortfolioPnlPercentage);
  const pnlLabelRaw = Number.isFinite(pnlRaw)
    ? `pnl${pnlRaw >= 0 ? '+' : '-'}${Math.abs(pnlRaw).toFixed(2)}pct`
    : 'pnl-unknown';
  const pnlLabel = pnlLabelRaw.replace(/[^a-zA-Z0-9+-.]/g, '_');

  const filename = `portfolio-backtest-${jobPart}-${dateLabel}-${pnlLabel}-${timestamp}.json`;

  return { filename, dateLabel, pnlLabel };
}

export async function savePortfolioBacktestResult(
  result: PortfolioBacktestResult,
  options: PortfolioResultSaveOptions = {}
): Promise<PortfolioResultSaveMetadata> {
  const prefix = options.prefix ? `${options.prefix} ` : '';

  if (!result.configUsed && options.portfolioParams) {
    result.configUsed = options.portfolioParams;
  }

  const serialized = options.serializedResult ?? JSON.stringify(result);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  const sizeMB = sizeBytes / (1024 * 1024);

  logger.info(`${prefix}Portfolio backtest results size: ${sizeMB.toFixed(2)}MB`);

  const { filename } = buildFilename(result, options);
  const portfolioResultsDir = getPortfolioResultsDirectory();
  const filepath = getPortfolioResultsFilePath(filename);

  await fs.promises.mkdir(portfolioResultsDir, { recursive: true });
  logger.debug(`${prefix}Portfolio results directory created/verified: ${portfolioResultsDir}`);

  try {
    await fs.promises.access(portfolioResultsDir, fs.constants.W_OK);
    logger.debug(`${prefix}Portfolio results directory is writable: ${portfolioResultsDir}`);
  } catch (accessError: any) {
    logger.error(`${prefix}Portfolio results directory is not writable: ${accessError.message}`);
    throw accessError;
  }

  try {
    try {
      const diskStats = await fs.promises.statfs(portfolioResultsDir);
      const availableSpaceGB = (diskStats.bavail * diskStats.bsize) / (1024 * 1024 * 1024);
      const requiredSpaceMB = sizeMB * 1.1;
      logger.info(`${prefix}Disk space check: available ${availableSpaceGB.toFixed(2)}GB, required ${requiredSpaceMB.toFixed(2)}MB`);

      if (availableSpaceGB * 1024 < requiredSpaceMB) {
        throw new Error(`Insufficient disk space: available ${availableSpaceGB.toFixed(2)}GB, required ${requiredSpaceMB.toFixed(2)}MB`);
      }
    } catch (diskError: any) {
      logger.warn(`${prefix}Could not check disk space: ${diskError.message}`);
    }

    await fs.promises.writeFile(filepath, serialized, 'utf8');
    logger.info(`${prefix}File write completed: ${filepath}`);

    const stats = await fs.promises.stat(filepath);
    logger.info(`${prefix}File verification successful: ${filename}, size: ${stats.size} bytes`);

    return {
      filename,
      filepath,
      downloadUrl: `/api/portfolio-results/${filename}`,
      sizeBytes: stats.size,
      sizeMB: Number(sizeMB.toFixed(2))
    };
  } catch (writeError: any) {
    logger.error(`${prefix}Failed to write portfolio results file: ${writeError.message}`);
    throw writeError;
  }
}


