import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
// import { StrategyParameters } from '../modules/strategy_logic/strategy'; // Удаляем этот импорт

// Определяем интерфейс для подключения к бирже
export interface ExchangeConnection {
  id: string; // uuid, будет генерироваться на клиенте или при создании
  name: string; // Пользовательское имя для подключения, например "My Main OKX"
  exchange: string; // Название биржи, например, 'OKX'
  apiKey: string;
  secretKey: string;
  passphrase?: string; // Для OKX
  isActive: boolean; // Является ли это подключение активным для использования
  isTestNet: boolean; // Используется ли тестовая сеть
}

@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn()
  id!: number;

  // Удаляем strategyParameters
  // @Column('jsonb') 
  // strategyParameters!: StrategyParameters;

  // Добавляем поле для хранения конфигураций подключений к биржам
  @Column('jsonb', { default: [] }) // Массив объектов ExchangeConnection
  exchangeConnections!: ExchangeConnection[];

  // Можно добавить другие глобальные настройки приложения сюда
  // @Column({ type: 'varchar', nullable: true })
  // okxApiKey?: string;

  // @Column({ type: 'varchar', nullable: true })
  // okxApiSecret?: string; // Важно: шифровать перед сохранением!

  // @Column({ type: 'varchar', nullable: true })
  // okxApiPassphrase?: string; // Важно: шифровать перед сохранением!

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
} 