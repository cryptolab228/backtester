import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { TradingPair } from './TradingPair';

@Entity('candles')
// Составной уникальный индекс для предотвращения дубликатов свечей
@Index(['tradingPair', 'timestamp', 'timeframe'], { unique: true })
// Индекс для быстрого поиска по паре и времени (полезно для бэктестов)
@Index(['tradingPair', 'timestamp'])
export class Candle {
  @PrimaryGeneratedColumn()
  id!: number;

  // Связь Many-to-One с TradingPair
  @ManyToOne(() => TradingPair, (pair) => pair.candles, { 
    nullable: false, 
    onDelete: 'CASCADE' // Удалять свечи при удалении пары
  })
  @JoinColumn({ name: 'pair_id' }) // Явно указываем имя внешнего ключа
  tradingPair!: TradingPair;

  @Column({ type: 'bigint' }) // Используем bigint для timestamp в миллисекундах
  timestamp!: number;

  @Column({ type: 'varchar', length: 10 }) // Таймфрейм ('15m', '1h', etc.)
  timeframe!: string;

  @Column({ type: 'decimal', precision: 28, scale: 18 }) // Увеличено с 18,8 до 28,18
  open!: number;

  @Column({ type: 'decimal', precision: 28, scale: 18 })
  high!: number;

  @Column({ type: 'decimal', precision: 28, scale: 18 })
  low!: number;

  @Column({ type: 'decimal', precision: 28, scale: 18 })
  close!: number;

  @Column({ type: 'decimal', precision: 30, scale: 8 }) // Увеличено для объемов
  volume!: number;

  @Column({ type: 'decimal', precision: 30, scale: 8, nullable: true }) // Объем в котируемой валюте
  volumeQuote?: number;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
} 