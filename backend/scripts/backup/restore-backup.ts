// Phase 26: restores a backup file into a target PostgreSQL database via
// `pg_restore --clean --if-exists`.
//
// Usage:
//   TARGET_DATABASE_URL=postgresql://user:pass@host:port/scratch_db \
//     npm run backup:restore -- /path/to/foodbridge-20260101-020000.dump
//
// Deliberately reads the target from TARGET_DATABASE_URL, never from
// DATABASE_URL - see README.md's "how to avoid restoring into the wrong
// database". If TARGET_DATABASE_URL is unset, this refuses to fall back
// to DATABASE_URL (that would silently restore into whatever database
// the running application itself is configured to use, which is exactly
// the mistake this separation exists to prevent).
//
// If TARGET_DATABASE_URL happens to be textually identical to
// DATABASE_URL (i.e. you really do intend to restore in place - a
// deliberate, rare emergency action, not routine disaster-recovery
// testing), pass --force to proceed anyway. Without --force this
// combination is refused outright.
//
// `--clean --if-exists` drops existing objects before recreating them,
// so this is destructive to whatever is already in the target database -
// always double-check TARGET_DATABASE_URL's database name (printed
// below, credentials never included) before confirming.

import dotenv from 'dotenv';
import { spawn } from 'child_process';
import fs from 'fs';
import { parseDatabaseUrl, buildPgRestoreArgs } from '../../src/backup/lib.js';

dotenv.config();

function runPgRestore(args: string[], password: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_restore', args, {
      env: { ...process.env, PGPASSWORD: password },
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function main() {
  const dumpFile = process.argv[2];
  const force = process.argv.includes('--force');

  if (!dumpFile) {
    console.error('Usage: TARGET_DATABASE_URL=... npm run backup:restore -- /path/to/backup.dump [--force]');
    process.exit(1);
    return;
  }

  if (!fs.existsSync(dumpFile)) {
    console.error(`[restore] FATAL: file does not exist: ${dumpFile}`);
    process.exit(1);
    return;
  }

  const targetUrl = process.env.TARGET_DATABASE_URL?.trim();
  if (!targetUrl) {
    console.error('[restore] FATAL: TARGET_DATABASE_URL is not set.');
    console.error(
      '[restore] This is intentional - see this script\'s own header comment for why restore never falls ' +
        'back to DATABASE_URL.'
    );
    process.exit(1);
    return;
  }

  if (targetUrl === process.env.DATABASE_URL && !force) {
    console.error(
      '[restore] FATAL: TARGET_DATABASE_URL is identical to DATABASE_URL - refusing to restore over the ' +
        'database this application is currently configured to use.'
    );
    console.error('[restore] If this is really intended (a genuine emergency restore-in-place), re-run with --force.');
    process.exit(1);
    return;
  }

  const conn = parseDatabaseUrl(targetUrl);

  console.log(`[restore] Target database: "${conn.database}" on ${conn.host}:${conn.port}`);
  console.log('[restore] This will DROP and recreate every object currently in the target database.');
  console.log(`[restore] Restoring from: ${dumpFile}`);

  let result: { code: number | null; stderr: string };
  try {
    result = await runPgRestore(buildPgRestoreArgs(conn, dumpFile), conn.password);
  } catch (error) {
    console.error(
      '[restore] FATAL: failed to start pg_restore - is it installed and on PATH?',
      error instanceof Error ? error.message : 'unknown error'
    );
    process.exit(1);
    return;
  }

  if (result.code !== 0) {
    console.error(`[restore] FATAL: pg_restore exited with code ${result.code}.`);
    if (result.stderr.trim()) {
      console.error('[restore] pg_restore stderr:', result.stderr.trim());
    }
    process.exit(1);
    return;
  }

  console.log('[restore] pg_restore completed successfully.');
  console.log(
    '[restore] Next: decide whether `npx prisma migrate deploy` is needed against this database (only if ' +
      'migrations were applied after this backup was taken), then verify data and application health before ' +
      'directing any real traffic here - see README.md\'s "Restore" section.'
  );
}

main().catch((error) => {
  console.error('[restore] FATAL: unexpected error:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
