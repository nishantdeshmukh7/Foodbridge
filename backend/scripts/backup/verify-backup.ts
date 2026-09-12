// Phase 26: verifies a backup file is actually usable - Step 5's explicit
// requirement that a `.dump` file existing is not, by itself, evidence of
// a valid backup.
//
// Usage:
//   npm run backup:verify -- /path/to/foodbridge-20260101-020000.dump
//
// Checks (in order, stopping at the first failure):
//   1. the file exists
//   2. the file is non-empty
//   3. `pg_restore --list` can read it (i.e. it's a well-formed custom-
//      format archive, not truncated/corrupted)
//   4. the archive's table of contents includes every table this
//      application actually has (EXPECTED_TABLES in lib.ts)
//
// Needs no database connection and no credential whatsoever - `pg_restore
// --list` only reads the archive file's own table of contents.

import { spawn } from 'child_process';
import fs from 'fs';
import { buildPgRestoreListArgs, findMissingExpectedTables } from '../../src/backup/lib.js';

function runPgRestoreList(dumpFile: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_restore', buildPgRestoreListArgs(dumpFile));

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  const dumpFile = process.argv[2];
  if (!dumpFile) {
    console.error('Usage: npm run backup:verify -- /path/to/backup.dump');
    process.exit(1);
    return;
  }

  if (!fs.existsSync(dumpFile)) {
    console.error(`[verify] FAIL: file does not exist: ${dumpFile}`);
    process.exit(1);
    return;
  }

  const stats = fs.statSync(dumpFile);
  if (stats.size === 0) {
    console.error(`[verify] FAIL: file is empty: ${dumpFile}`);
    process.exit(1);
    return;
  }
  console.log(`[verify] OK: file exists and is non-empty (${stats.size} bytes).`);

  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await runPgRestoreList(dumpFile);
  } catch (error) {
    console.error(
      '[verify] FATAL: failed to run pg_restore - is it installed and on PATH?',
      error instanceof Error ? error.message : 'unknown error'
    );
    process.exit(1);
    return;
  }

  if (result.code !== 0) {
    console.error('[verify] FAIL: pg_restore --list could not read this file - it may be truncated or corrupted.');
    if (result.stderr.trim()) {
      console.error('[verify] pg_restore stderr:', result.stderr.trim());
    }
    process.exit(1);
    return;
  }
  console.log('[verify] OK: pg_restore --list can read the archive.');

  const missing = findMissingExpectedTables(result.stdout);
  if (missing.length > 0) {
    console.error(`[verify] FAIL: backup is missing expected table(s): ${missing.join(', ')}`);
    process.exit(1);
    return;
  }
  console.log('[verify] OK: every expected application table is present in the backup.');

  console.log(`[verify] PASS: ${dumpFile} looks like a valid, complete FoodBridge backup.`);
  console.log(
    '[verify] Note: this confirms the archive is well-formed and complete - it does not by itself prove the ' +
      'data inside is correct. Run an actual restore drill periodically (see README.md "Backup testing").'
  );
}

main().catch((error) => {
  console.error('[verify] FATAL: unexpected error:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
