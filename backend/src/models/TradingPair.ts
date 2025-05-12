import { Entity, PrimaryGeneratedColumn, Column, Index, OneToMany } from 'typeorm';
import { Candle } from './Candle'; // Импортируем Candle для связи

@Entity('trading_pairs')
@Index(['symbol'], { unique: true }) // Уникальный индекс по символу
export class TradingPair {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  symbol!: string; // Например, 'BTC-USDT-SWAP'

  @Column({ type: 'varchar', length: 20 })
  baseCurrency!: string; // Например, 'BTC'

  @Column({ type: 'varchar', length: 20 })
  quoteCurrency!: string; // Например, 'USDT'

  @Column({ type: 'varchar', length: 20 })
  instrumentType!: string; // Например, 'SWAP' или 'FUTURES'

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;

  // Связь One-to-Many с Candle
  @OneToMany(() => Candle, (candle) => candle.tradingPair)
  candles!: Candle[];
} 