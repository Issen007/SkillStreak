import 'reflect-metadata';
import { config } from 'dotenv';
import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

// Loaded for the standalone TypeORM CLI (migration:generate/run/revert,
// seed script) which runs outside Nest's bootstrap and therefore outside
// @nestjs/config's ConfigModule.
config();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  // Postgres has a built-in pgcrypto-backed gen_random_uuid(); TypeORM
  // auto-installs the extension (CREATE EXTENSION IF NOT EXISTS) the first
  // time it sees a uuid-generated column, so no manual step is needed.
  uuidExtension: 'pgcrypto',
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  // Migrations only, never synchronize — per docs/adr/0002-data-model.md
  // ("schema changes go through migrations, never manual edits").
  synchronize: false,
  logging:
    process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
