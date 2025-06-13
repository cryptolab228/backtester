import { Entity, PrimaryGeneratedColumn, Column, Index, OneToMany } from 'typeorm';
import { Candle } from './Candle'; // Импортируем Candle для связи

@Entity('trading_pairs')
@Index(['symbol', 'exchange'], { unique: true }) // Уникальный составной индекс по символу и бирже
export class TradingPair {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  symbol!: string; // Например, 'BTC-USDT-SWAP' для OKX или 'BTCUSDT' для Bybit

  @Column({ type: 'varchar', length: 20 })
  baseCurrency!: string; // Например, 'BTC'

  @Column({ type: 'varchar', length: 20 })
  quoteCurrency!: string; // Например, 'USDT'

  @Column({ type: 'varchar', length: 20 })
  instrumentType!: string; // Например, 'SWAP' или 'FUTURES'

  @Column({ type: 'varchar', length: 20, default: 'okx' })
  exchange!: string; // 'okx' | 'bybit' - новое поле для поддержки мультибиржевости

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;

  // Связь One-to-Many с Candle
  @OneToMany(() => Candle, (candle) => candle.tradingPair)
  candles!: Candle[];
} 