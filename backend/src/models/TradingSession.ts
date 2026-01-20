import { Column, CreateDateColumn, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { SessionTrade } from './SessionTrade';
import { SessionMetrics } from './SessionMetrics';

export type SessionSource = 'scanner';
export type SessionMode = 'dry-run' | 'paper' | 'shadow' | 'demo' | 'testnet' | 'live' | 'backtest';
export type SessionStatus = 'created' | 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted';

@Entity({ name: 'trading_sessions' })
export class TradingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  source!: SessionSource;

  @Column({ type: 'varchar', length: 32 })
  mode!: SessionMode;

  @Column({ type: 'text', nullable: true })
  strategyVersion!: string | null;

  @Column({ type: 'text', nullable: true })
  strategyParamsHash!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  strategyParamsSnapshot!: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  exchange!: string | null;

  @Column({ type: 'text', array: true, nullable: true })
  pairs!: string[] | null;

  @Column({ type: 'text', array: true, nullable: true })
  timeframes!: string[] | null;

  @Column({ type: 'boolean', default: false })
  portfolioMode!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  configSnapshot!: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  riskSettingsSnapshot!: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  allocatorConfigSnapshot!: Record<string, any> | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'varchar', length: 32, default: 'running' })
  status!: SessionStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'text', nullable: true })
  name!: string | null;

  @Column({ type: 'boolean', default: false })
  autoStarted!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'text', nullable: true })
  createdBy!: string | null;

  @OneToMany(() => SessionTrade, (trade) => trade.session)
  trades!: SessionTrade[];

  @OneToOne(() => SessionMetrics, (metrics) => metrics.session)
  metrics!: SessionMetrics;
}


