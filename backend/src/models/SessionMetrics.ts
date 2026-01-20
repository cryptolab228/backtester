import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TradingSession } from './TradingSession';

@Entity({ name: 'session_metrics' })
export class SessionMetrics {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @OneToOne(() => TradingSession, (session) => session.metrics, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: TradingSession;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  updatedAt!: Date;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  totalPnl!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  realizedPnl!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  unrealizedPnl!: string;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  totalReturnPct!: string;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  winRatePct!: string;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  profitFactor!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  avgTradePnl!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  avgWinPnl!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  avgLossPnl!: string;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  sharpeRatio!: string;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  sortinoRatio!: string;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  maxDrawdownPct!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  maxDrawdownAmount!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  expectancy!: string;

  @Column({ type: 'integer', default: 0 })
  tradeCount!: number;

  @Column({ type: 'integer', default: 0 })
  winningTrades!: number;

  @Column({ type: 'integer', default: 0 })
  losingTrades!: number;

  @Column({ type: 'integer', default: 0 })
  openPositions!: number;

  @Column({ type: 'integer', default: 0 })
  closedPositions!: number;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  avgConcurrentTrades!: string;

  @Column({ type: 'integer', default: 0 })
  peakConcurrentTrades!: number;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  latencyMsAvg!: string;

  @Column({ type: 'numeric', precision: 20, scale: 8, default: 0 })
  latencyMsP95!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;
}


