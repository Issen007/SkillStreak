// Wraps the TypeORM migration-run CLI (the same command
// `migration:run:prod`, package.json, and this file's own predecessor in
// docker-entrypoint.sh used to call directly) in a Postgres
// SESSION-LEVEL advisory lock, so 2+ concurrently-starting `api` replicas
// (k8s/api-deployment.yaml, back to `replicas: 2`) never race
// `migration:run` against each other — see k8s/README.md's now-resolved
// "Migration race with multiple api replicas" note for the incident this
// fixes (rollout stuck at "1 out of 2 new replicas", 2026-07-11).
//
// Only one pod's `pg_advisory_lock()` call actually acquires the lock; the
// rest block until it's released, then run `migration:run` themselves and
// immediately find nothing left to apply (TypeORM tracks applied
// migrations in its own `migrations` table) instead of racing to apply
// the same one twice.
//
// pg_advisory_lock/pg_advisory_unlock are SESSION-scoped — acquiring the
// lock on one Postgres connection and releasing it from a *different*
// connection silently does nothing, which would defeat this mechanism
// entirely. TypeORM's DataSource pools/rotates connections across
// ordinary queries, so the lock -> migrate -> unlock sequence below
// deliberately reserves ONE dedicated connection for its whole lifetime
// via `dataSource.createQueryRunner()` (not `dataSource.query(...)`,
// which could hand back a different pooled connection each call) and
// keeps that same QueryRunner open until the unlock query has actually
// run on it.
//
// MIGRATION_ADVISORY_LOCK_ID is an arbitrary fixed bigint, reserved
// exclusively for guarding concurrent `migration:run` attempts. It must
// never be reused for any other Postgres advisory lock this app might add
// later (session- or transaction-scoped) — pick a fresh constant for that
// instead, so the two can never collide and silently interfere with each
// other.
//
// The migration itself still runs as a separate child process invoking
// the real TypeORM CLI — this script only wraps that call in the lock, it
// doesn't reimplement migration-running, and it propagates the CLI's own
// exit code (a migration failure must fail the container start, not be
// swallowed).
//
// Usage (from docker-entrypoint.sh, after `nest build`/`pnpm install
// --prod` per backend/Dockerfile's runtime stage):
//   node dist/scripts/migrate-with-lock.js
// Reads DATABASE_URL from the environment, same as data-source.ts/the
// TypeORM CLI itself — docker-entrypoint.sh assembles it before this runs.
import { spawn } from 'child_process';
import dataSource from '../database/data-source';

const MIGRATION_ADVISORY_LOCK_ID = 847_260_151;

function runMigrationCli(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [
        './node_modules/typeorm/cli.js',
        '-d',
        'dist/database/data-source.js',
        'migration:run',
      ],
      { stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code !== null) {
        resolve(code);
      } else {
        // Killed by a signal rather than exiting normally — surface as a
        // failure rather than silently reporting success (exit code 0).
        reject(new Error(`migration:run was terminated by signal ${signal}`));
      }
    });
  });
}

async function run(): Promise<void> {
  await dataSource.initialize();
  // A dedicated, single connection reserved for this process's whole
  // lifetime — see module comment on why this can't be plain
  // dataSource.query(...) calls.
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  let exitCode = 1;
  try {
    console.log(
      `Waiting for Postgres advisory lock ${MIGRATION_ADVISORY_LOCK_ID} (migration:run)...`,
    );
    await queryRunner.query('SELECT pg_advisory_lock($1)', [
      MIGRATION_ADVISORY_LOCK_ID,
    ]);
    console.log('Lock acquired — running migrations...');

    try {
      exitCode = await runMigrationCli();
      console.log(`migration:run exited with code ${exitCode}.`);
    } finally {
      // Released on the SAME QueryRunner/connection/session the lock was
      // acquired on (see module comment) — always attempted, even if
      // migration:run itself failed, so a failed pod doesn't leave the
      // lock held until this process's connection eventually closes on
      // its own.
      await queryRunner.query('SELECT pg_advisory_unlock($1)', [
        MIGRATION_ADVISORY_LOCK_ID,
      ]);
    }
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }

  process.exitCode = exitCode;
}

run().catch((error: unknown) => {
  console.error('migrate-with-lock script crashed:', error);
  process.exitCode = 1;
});
