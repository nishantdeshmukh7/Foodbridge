// Phase 26: creates a single PostgreSQL logical backup via `pg_dump -Fc`
// and prunes old backups per the retention policy in lib.ts.
//
// Usage:
//   DATABASE_URL=postgresql://... npm run backup:create
//   BACKUP_DIR=/path/to/backups npm run backup:create   (default: ./backups)
//
// This is a script an operator or a scheduled job (cron, your platform's
// scheduled-task feature, a CI pipeline) runs - see README.md's "Backup &
// Recovery" section for how and how often. It is not started by the
// application server itself.
//
// Never logs DATABASE_URL, PGPASSWORD, or any other credential - only the
// non-secret parts (host, port, database name, file path).

import dotenv from 'dotenv';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  resolveBackupConfig,
  parseDatabaseUrl,
  buildBackupFilename,
  buildPgDumpArgs,
  parseBackupTimestamp,
  selectBackupsToDelete,
  type BackupFileInfo,
} from '../../src/backup/lib.js';

dotenv.config();

function runPgDump(args: string[], password: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', args, {
      // PGPASSWORD travels via the child's environment, never as a
      // command-line argument - argv is visible to other local users
      // (`ps aux`, /proc/<pid>/cmdline); env vars of another process are
      // not, absent additional OS-level access this script cannot control
      // either way.
      env: { ...process.env, PGPASSWORD: password },
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      // e.g. ENOENT - pg_dump is not installed/on PATH. Distinct from a
      // non-zero exit code, but both are real failures.
      reject(error);
    });

    child.on('close', (code) => {
      resolve({ code, stderr });
    });
  });
}

async function main() {
  const config = resolveBackupConfig(process.env);
  const conn = parseDatabaseUrl(config.databaseUrl);

  fs.mkdirSync(config.backupDir, { recursive: true });

  const finalFilename = buildBackupFilename();
  const finalPath = path.join(config.backupDir, finalFilename);

  // Never silently overwrite an existing backup (Step 4). Filenames are
  // timestamped to the second, so a real collision only happens if this
  // is run twice within the same second - refusing outright, rather than
  // guessing a suffix, keeps the failure mode obvious.
  if (fs.existsSync(finalPath)) {
    console.error(`FATAL: a backup already exists at ${finalPath} - refusing to overwrite it.`);
    process.exit(1);
  }

  // Written to a .tmp path first, and only renamed to the real filename
  // once pg_dump has actually succeeded AND the result passed a basic
  // sanity check (non-empty). This means a failed/partial run never
  // leaves a file at the "real" name that a later verification or
  // restore step could mistake for a complete backup.
  const tmpPath = `${finalPath}.tmp`;
  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }

  console.log(`[backup] Starting pg_dump for database "${conn.database}" on ${conn.host}:${conn.port} ...`);

  let result: { code: number | null; stderr: string };
  try {
    result = await runPgDump(buildPgDumpArgs(conn, tmpPath), conn.password);
  } catch (error) {
    console.error(
      '[backup] FATAL: failed to start pg_dump - is it installed and on PATH?',
      error instanceof Error ? error.message : 'unknown error'
    );
    process.exit(1);
    return;
  }

  if (result.code !== 0) {
    console.error(`[backup] FATAL: pg_dump exited with code ${result.code}.`);
    if (result.stderr.trim()) {
      console.error('[backup] pg_dump stderr:', result.stderr.trim());
    }
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
    process.exit(1);
    return;
  }

  // Never trust a zero exit code alone - a zero-byte file is not a
  // successful backup, whatever pg_dump's own exit code claims.
  const stats = fs.statSync(tmpPath);
  if (stats.size === 0) {
    console.error('[backup] FATAL: pg_dump reported success but produced an empty file.');
    fs.unlinkSync(tmpPath);
    process.exit(1);
    return;
  }

  fs.renameSync(tmpPath, finalPath);
  console.log(`[backup] Wrote ${finalPath} (${stats.size} bytes).`);
  console.log(
    '[backup] This is a logical backup only - verify it (npm run backup:verify -- ' +
      `"${finalPath}") before relying on it, and see README.md's "Backup & Recovery" ` +
      'section for storing a copy off this machine.'
  );

  // Retention pruning.
  const entries = fs
    .readdirSync(config.backupDir)
    .map((filename) => {
      const createdAt = parseBackupTimestamp(filename);
      return createdAt ? ({ filename, createdAt } satisfies BackupFileInfo) : null;
    })
    .filter((entry): entry is BackupFileInfo => entry !== null);

  const toDelete = selectBackupsToDelete(entries, config.retentionDailyCount, config.retentionWeeklyCount);
  for (const filename of toDelete) {
    fs.unlinkSync(path.join(config.backupDir, filename));
    console.log(`[backup] Pruned old backup per retention policy: ${filename}`);
  }
}

main().catch((error) => {
  console.error('[backup] FATAL: unexpected error:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
