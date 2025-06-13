import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn, ValueTransformer } from 'typeorm';
import { TradingPair } from './TradingPair';

// Трансформер для корректного преобразования decimal значений из БД в numbers
const numberTransformer: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string) => parseFloat(value)
};

// Трансформер для timestamp - обеспечиваем, что всегда получаем number
const timestampTransformer: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | number) => {
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return value;
  }
};

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

  @Column({ 
    type: 'bigint',
    transformer: timestampTransformer
  }) // Используем bigint для timestamp в миллисекундах
  timestamp!: number;

  @Column({ type: 'varchar', length: 10 }) // Таймфрейм ('15m', '1h', etc.)
  timeframe!: string;

  @Column({ 
    type: 'decimal', 
    precision: 28, 
    scale: 18,
    transformer: numberTransformer
  }) // Увеличено с 18,8 до 28,18
  open!: number;

  @Column({ 
    type: 'decimal', 
    precision: 28, 
    scale: 18,
    transformer: numberTransformer
  })
  high!: number;

  @Column({ 
    type: 'decimal', 
    precision: 28, 
    scale: 18,
    transformer: numberTransformer
  })
  low!: number;

  @Column({ 
    type: 'decimal', 
    precision: 28, 
    scale: 18,
    transformer: numberTransformer
  })
  close!: number;

  @Column({ 
    type: 'decimal', 
    precision: 30, 
    scale: 8,
    transformer: numberTransformer
  }) // Увеличено для объемов
  volume!: number;

  @Column({ 
    type: 'decimal', 
    precision: 30, 
    scale: 8, 
    nullable: true,
    transformer: numberTransformer
  }) // Объем в котируемой валюте
  volumeQuote?: number;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;
} 