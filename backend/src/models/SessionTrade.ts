import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TradingSession } from './TradingSession';

export type TradeSource = 'scanner';
export type TradeStatus = 'open' | 'closed' | 'cancelled';

@Entity({ name: 'session_trades' })
export class SessionTrade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => TradingSession, (session) => session.trades, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: TradingSession;

  @Column({ type: 'varchar', length: 32 })
  source!: TradeSource;

  @Column({ type: 'text', nullable: true })
  mode!: string | null;

  @Column({ type: 'text' })
  pair!: string;

  @Column({ type: 'text', nullable: true })
  timeframe!: string | null;

  @Column({ type: 'text', nullable: true })
  direction!: string | null;

  @Column({ type: 'text', nullable: true })
  exchange!: string | null;

  @Column({ type: 'text', nullable: true })
  strategyId!: string | null;

  @Column({ type: 'text', nullable: true })
  signalId!: string | null;

  @Column({ type: 'text', nullable: true })
  allocationId!: string | null;

  @Column({ type: 'text', nullable: true })
  orderLinkId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  entryTimestamp!: Date | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  entryPrice!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  entryFee!: string | null;

  @Column({ type: 'text', nullable: true })
  entryReason!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  exitTimestamp!: Date | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  exitPrice!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  exitFee!: string | null;

  @Column({ type: 'text', nullable: true })
  exitReason!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  positionSize!: string | null;

  @Column({ type: 'numeric', precision: 20, scale: 4, nullable: true })
  leverage!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  realizedPnl!: string | null;

  @Column({ type: 'numeric', precision: 20, scale: 8, nullable: true })
  realizedPnlPct!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  maxFavorableExcursion!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  maxAdverseExcursion!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  stopLoss!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  takeProfit!: string | null;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  trailingStop!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 6, nullable: true })
  riskScore!: string | null;

  @Column({ type: 'integer', nullable: true })
  confirmationAttempts!: number | null;

  @Column({ type: 'integer', nullable: true })
  latencyMs!: number | null;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: TradeStatus;

  @Column({ type: 'jsonb', nullable: true })
  extra!: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}


