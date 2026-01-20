import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('test_results')
export class TestResult {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ unique: true })
  testId!: string;

  @Column({ type: 'text', array: true, nullable: true })
  logs!: string[];

  @Column({ type: 'jsonb', nullable: true })
  resultData!: any;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

