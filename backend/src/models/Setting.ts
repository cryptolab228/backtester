import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { StrategyParameters } from '../modules/strategy_logic/strategy'; // Путь может потребовать корректировки

@Entity('settings')
export class Setting {
  @PrimaryGeneratedColumn()
  id!: number;

  // Мы будем хранить все параметры стратегии как один JSON объект.
  // Это упрощает добавление новых параметров без изменения схемы таблицы.
  @Column('jsonb') // jsonb для PostgreSQL, для других БД может быть 'json'
  strategyParameters!: StrategyParameters;

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