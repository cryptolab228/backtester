import 'module-alias/register';
import 'reflect-metadata';
import logger from '../utils/logger';
import { initializeDataSource } from '../config/dataSource';
import { dataService } from '../services/dataService';
import { BacktestRunParameters } from '../modules/backtester/backtester.types';
import { getDefaultStrategyParameters } from '../config/defaultStrategyParameters';
import { runBacktest } from '../modules/backtester/backtester';
import { runGPUBacktestValidation, checkGPUServiceHealth } from '../services/gpuService';

interface CliArgs {
	pair: string;
	timeframe: string;
	start?: string;
	end?: string;
	days?: number;
	initial: number;
	exchange?: string;
	useDbRange?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args: any = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--pair' && argv[i + 1]) args.pair = argv[++i];
		else if (a === '--timeframe' && argv[i + 1]) args.timeframe = argv[++i];
		else if (a === '--start' && argv[i + 1]) args.start = argv[++i];
		else if (a === '--end' && argv[i + 1]) args.end = argv[++i];
		else if (a === '--days' && argv[i + 1]) args.days = Number(argv[++i]);
		else if (a === '--initial' && argv[i + 1]) args.initial = Number(argv[++i]);
		else if (a === '--exchange' && argv[i + 1]) args.exchange = argv[++i];
		else if (a === '--use-db-range') args.useDbRange = true;
	}
	if (!args.pair || !args.timeframe || !args.initial) {
		throw new Error('Usage: node dist/scripts/compareCpuGpu.js --pair BTCUSDT --timeframe 1h --initial 10000 [--start ISO] [--end ISO] [--days 30] [--exchange bybit|okx] [--use-db-range]');
	}
	return args as CliArgs;
}

async function main() {
	try {
		const args = parseArgs(process.argv.slice(2));
		logger.info(`[CompareCpuGpu] Starting. Pair=${args.pair}, TF=${args.timeframe}, Start=${args.start || '-'}, End=${args.end || '-'}, Days=${args.days || '-'}, Exchange=${args.exchange || 'any'}, Initial=${args.initial}`);

		await initializeDataSource();

		// Discover DB range for the pair/timeframe (and exchange if provided)
		const allCandles = await dataService.getCandles(args.pair, args.timeframe, undefined as any, undefined as any, args.exchange);
		if (!allCandles || allCandles.length === 0) {
			logger.warn('[CompareCpuGpu] No candles found in DB for the requested pair/timeframe. Please fetch data first.');
			process.exit(2);
		}
		const dbStart = Number(allCandles[0].timestamp);
		const dbEnd = Number(allCandles[allCandles.length - 1].timestamp);
		logger.info(`[CompareCpuGpu] DB range detected: ${new Date(dbStart).toISOString()} .. ${new Date(dbEnd).toISOString()} (${allCandles.length} candles)`);

		// Resolve requested range
		let startTs: number;
		let endTs: number;
		if (args.start && args.end) {
			const s = new Date(args.start).getTime();
			const e = new Date(args.end).getTime();
			if (isNaN(s) || isNaN(e)) throw new Error('Invalid start or end date. Use ISO strings.');
			startTs = Math.max(s, dbStart);
			endTs = Math.min(e, dbEnd);
		} else if (args.days && args.days > 0) {
			const now = Date.now();
			const tentativeEnd = Math.min(now, dbEnd);
			const tentativeStart = tentativeEnd - args.days * 24 * 60 * 60 * 1000;
			startTs = Math.max(tentativeStart, dbStart);
			endTs = tentativeEnd;
		} else if (args.useDbRange) {
			startTs = dbStart;
			endTs = dbEnd;
		} else {
			// Default: last 30 days within DB range
			const tentativeEnd = dbEnd;
			const tentativeStart = tentativeEnd - 30 * 24 * 60 * 60 * 1000;
			startTs = Math.max(tentativeStart, dbStart);
			endTs = tentativeEnd;
		}
		logger.info(`[CompareCpuGpu] Using range: ${new Date(startTs).toISOString()} .. ${new Date(endTs).toISOString()}`);

		// Fetch bounded range
		const candlesFromDB = await dataService.getCandles(args.pair, args.timeframe, startTs, endTs, args.exchange);
		if (!candlesFromDB || candlesFromDB.length === 0) {
			logger.warn('[CompareCpuGpu] No candles found in DB for specified range. Please fetch data first.');
			process.exit(2);
		}
		const candles = candlesFromDB.map(c => ({
			timestamp: Number(c.timestamp),
			open: c.open,
			high: c.high,
			low: c.low,
			close: c.close,
			volume: c.volume,
		}));

		const strategyParameters = getDefaultStrategyParameters();
		const runParams: BacktestRunParameters = {
			pairSymbol: args.pair,
			timeframe: args.timeframe,
			startDate: args.start!,
			endDate: args.end!,
			initialCapital: args.initial,
			strategyParameters,
		};

		// CPU
		logger.info('[CompareCpuGpu] Running CPU backtest...');
		const cpu = await runBacktest(runParams, candles);
		logger.info(`[CompareCpuGpu] CPU done. Trades=${cpu.metrics.totalTrades}, PnL=${cpu.metrics.totalPnl.toFixed(2)}`);

		// GPU health (только если не отключен)
		const DISABLE_GPU_SERVICE = process.env.DISABLE_GPU_SERVICE === 'true';
		if (!DISABLE_GPU_SERVICE) {
			const gpuOk = await checkGPUServiceHealth();
			if (!gpuOk) {
				logger.error('[CompareCpuGpu] GPU service is not available. Aborting GPU comparison.');
				process.exit(3);
			}
		} else {
			logger.info('[CompareCpuGpu] GPU service disabled by environment variable. Skipping GPU comparison.');
		}

		// GPU (validation using CPU strategy candles)
		logger.info('[CompareCpuGpu] Running GPU backtest (validation mode)...');
		const gpu = await runGPUBacktestValidation(runParams, cpu.strategyCandles || []);
		logger.info(`[CompareCpuGpu] GPU done. Trades=${gpu.metrics.totalTrades}, PnL=${gpu.metrics.totalPnl?.toFixed(2)}`);

		// Summary
		const summary = {
			cpu: {
				totalTrades: cpu.metrics.totalTrades,
				totalPnl: cpu.metrics.totalPnl,
				winRate: cpu.metrics.winRate,
				maxDrawdown: cpu.metrics.maxDrawdown,
			},
			gpu: {
				totalTrades: gpu.metrics.totalTrades,
				totalPnl: gpu.metrics.totalPnl,
				winRate: gpu.metrics.winRate,
				maxDrawdown: gpu.metrics.maxDrawdown,
			},
			diffs: {
				trades: Math.abs(cpu.metrics.totalTrades - gpu.metrics.totalTrades),
				pnlAbs: Math.abs(cpu.metrics.totalPnl - (gpu.metrics.totalPnl || 0)),
				winRateAbs: Math.abs(cpu.metrics.winRate - (gpu.metrics.winRate || 0)),
				maxDrawdownAbs: Math.abs(cpu.metrics.maxDrawdown - (gpu.metrics.maxDrawdown || 0)),
			},
		};

		// Output concise summary
		// eslint-disable-next-line no-console
		console.log(JSON.stringify({ success: true, summary }, null, 2));
		process.exit(0);
	} catch (err: any) {
		logger.error('[CompareCpuGpu] Error:', { message: err?.message, stack: err?.stack });
		// eslint-disable-next-line no-console
		console.error(JSON.stringify({ success: false, error: err?.message }, null, 2));
		process.exit(1);
	}
}

main();


