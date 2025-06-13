import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTradingPairsIndexes1234567890123 implements MigrationInterface {
    name = 'AddTradingPairsIndexes1234567890123'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Добавляем индекс для оптимизации сортировки по exchange и symbol
        await queryRunner.query(`CREATE INDEX "IDX_trading_pairs_exchange_symbol" ON "trading_pairs" ("exchange", "symbol")`);
        
        // Добавляем индекс для быстрого поиска по символу
        await queryRunner.query(`CREATE INDEX "IDX_trading_pairs_symbol" ON "trading_pairs" ("symbol")`);
        
        // Добавляем индекс для фильтрации по бирже
        await queryRunner.query(`CREATE INDEX "IDX_trading_pairs_exchange" ON "trading_pairs" ("exchange")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Удаляем созданные индексы
        await queryRunner.query(`DROP INDEX "IDX_trading_pairs_exchange_symbol"`);
        await queryRunner.query(`DROP INDEX "IDX_trading_pairs_symbol"`);
        await queryRunner.query(`DROP INDEX "IDX_trading_pairs_exchange"`);
    }
} 