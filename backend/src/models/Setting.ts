import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Определяем интерфейс для подключения к бирже (отдельно от модели)
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

// Специальный тип для хранения настроек подключений к биржам
export interface ExchangeConnectionsSettings {
  exchangeConnections: ExchangeConnection[];
}

@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  key!: string; // Ключ настройки (например, 'default_timeframe')

  @Column({ type: 'text', nullable: true })
  value?: string; // Значение настройки

  @Column({ type: 'text', nullable: true })
  description?: string; // Описание настройки

  @Column({ type: 'varchar', length: 100, default: 'general' })
  category!: string; // Категория настройки

  // Специальное поле для хранения настроек подключений к биржам
  @Column({ type: 'json', nullable: true })
  exchangeConnections?: ExchangeConnection[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
} 