// Phase 26: shared logic for the three backup CLI entrypoints
// (create-backup.ts, verify-backup.ts, restore-backup.ts) in this
// directory. Every function here is pure and side-effect free (same
// convention as backend/src/config/index.ts's resolveCorsOrigin/
// resolveEmailConfig/etc.) so it is directly unit testable without
// spawning a real pg_dump/pg_restore process or touching a real
// filesystem/database - see backend/src/test/backup-lib.test.ts.
//
// Deliberately standalone from backend/src/config/index.ts: a backup
// operator/CI job has no reason to know FoodBridge's JWT_SECRET or SMTP
// credentials just to take a database backup, so this reads only the
// small, backup-specific set of environment variables it actually needs
// (DATABASE_URL plus BACKUP_*), rather than importing the full app config
// (which would fail startup over unrelated missing app secrets).

import path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BackupConfig {
  databaseUrl: string;
  backupDir: string;
  retentionDailyCount: number;
  retentionWeeklyCount: number;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (got "${raw}").`);
  }
  return value;
}

// Mirrors assertValidDatabaseUrl() in src/config/index.ts - deliberately
// duplicated rather than imported, to keep this module's only dependency
// on the rest of the app at zero. Never echoes the value itself in any
// thrown message (it may contain real credentials).
export function resolveBackupConfig(env: Record<string, string | undefined>): BackupConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set.');
  }
  if (!/^postgres(ql)?:\/\/\S+$/.test(databaseUrl)) {
    throw new Error(
      'DATABASE_URL does not look like a valid PostgreSQL connection string ' +
        '(expected it to start with postgresql:// or postgres://).'
    );
  }

  const backupDir = env.BACKUP_DIR?.trim() || path.join(process.cwd(), 'backups');

  // Phase 26 retention: a simple two-tier "grandfather-father" scheme -
  // keep the most recent N backups unconditionally (the "daily" tier),
  // then keep at most one further backup per distinct week for W more
  // weeks (the "weekly" tier) before anything is deleted. Defaults (7
  // daily + 4 weekly) match what README.md already documented as a
  // starting point - sensible for a single small production deployment,
  // not an enterprise compliance schedule, and fully overridable.
  const retentionDailyCount = parseNonNegativeInt(env.BACKUP_RETENTION_DAILY_COUNT, 7, 'BACKUP_RETENTION_DAILY_COUNT');
  const retentionWeeklyCount = parseNonNegativeInt(
    env.BACKUP_RETENTION_WEEKLY_COUNT,
    4,
    'BACKUP_RETENTION_WEEKLY_COUNT'
  );

  return { databaseUrl, backupDir, retentionDailyCount, retentionWeeklyCount };
}

// ---------------------------------------------------------------------------
// Connection string parsing
// ---------------------------------------------------------------------------

export interface PgConnectionParts {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

// Deliberately returns connection parts to be passed as discrete pg_dump/
// pg_restore flags (-h/-p/-U/-d) plus a PGPASSWORD environment variable -
// never as the raw connection-string argument. A full connection string
// passed on argv is visible to any other local user via `ps aux` or
// /proc/<pid>/cmdline; PGPASSWORD in the child process's own environment
// is not (see runPgCommand() in the CLI entrypoints).
export function parseDatabaseUrl(databaseUrl: string): PgConnectionParts {
  const parsed = new URL(databaseUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (!parsed.hostname || !database) {
    throw new Error('DATABASE_URL is missing a host or database name.');
  }

  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
  };
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

const FILENAME_PATTERN = /^foodbridge-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;

export function buildBackupFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `foodbridge-${stamp}.dump`;
}

// Only recognizes this script's own filename shape - returns null for
// anything else (a stray .tmp file, an unrelated file an operator dropped
// in the same directory, etc.) so retention pruning never considers
// deleting a file it didn't create.
export function parseBackupTimestamp(filename: string): Date | null {
  const match = FILENAME_PATTERN.exec(filename);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

// ---------------------------------------------------------------------------
// pg_dump / pg_restore command construction
// ---------------------------------------------------------------------------

// -Fc (custom format): compressed, and the only format pg_restore can
// selectively restore from, list the contents of, or parallelize -
// preferred over a plain SQL dump for exactly the reasons README.md's
// existing "Backup & Recovery" section already gives.
export function buildPgDumpArgs(conn: PgConnectionParts, outputFile: string): string[] {
  return ['-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', conn.database, '-Fc', '-f', outputFile];
}

// --list reads only the archive's own table of contents - it needs no
// database connection at all, which is exactly why backup verification
// (Step 5) never needs any credential, not even to a scratch database.
export function buildPgRestoreListArgs(dumpFile: string): string[] {
  return ['--list', dumpFile];
}

export function buildPgRestoreArgs(conn: PgConnectionParts, dumpFile: string): string[] {
  return ['--clean', '--if-exists', '-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', conn.database, dumpFile];
}

// ---------------------------------------------------------------------------
// Retention pruning
// ---------------------------------------------------------------------------

export interface BackupFileInfo {
  filename: string;
  createdAt: Date;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weekBucket(date: Date): number {
  return Math.floor(date.getTime() / ONE_WEEK_MS);
}

// Given the full set of existing backups, returns exactly the filenames
// that should be deleted under the two-tier retention policy described in
// resolveBackupConfig() above. Pure - callers are responsible for
// actually deleting the returned filenames.
export function selectBackupsToDelete(
  files: BackupFileInfo[],
  dailyCount: number,
  weeklyCount: number
): string[] {
  const sortedNewestFirst = [...files].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = new Set<string>();

  for (const file of sortedNewestFirst.slice(0, dailyCount)) {
    keep.add(file.filename);
  }

  const remaining = sortedNewestFirst.slice(dailyCount);
  const seenWeeks = new Set<number>();
  for (const file of remaining) {
    const bucket = weekBucket(file.createdAt);
    if (!seenWeeks.has(bucket) && seenWeeks.size < weeklyCount) {
      seenWeeks.add(bucket);
      keep.add(file.filename);
    }
  }

  return sortedNewestFirst.filter((file) => !keep.has(file.filename)).map((file) => file.filename);
}

// ---------------------------------------------------------------------------
// Backup verification (Step 5)
// ---------------------------------------------------------------------------

// Every persistent model in prisma/schema.prisma, as the actual Postgres
// table name (no @@map anywhere in the schema, so these are exactly the
// Prisma model names). Kept here, not derived from the schema file at
// runtime, so this script has zero dependency on Prisma's own tooling -
// it only ever shells out to pg_dump/pg_restore.
export const EXPECTED_TABLES = [
  'User',
  'Donation',
  'PickupRequest',
  'Delivery',
  'AdminLog',
  'Notification',
  'Verification',
  'PasswordResetToken',
] as const;

// Parses `pg_restore --list` output. A TABLE entry line looks like:
//   3421; 1259 24601 TABLE public User someowner
// (semicolon-separated dump-id/catalog-id/oid, then object type, schema,
// name, owner). Only TABLE entries are relevant to "does this backup
// contain the tables we expect".
const TABLE_LINE_PATTERN = /^\d+;\s+\d+\s+\d+\s+TABLE\s+\S+\s+(\S+)\s+/;

export function extractTableNamesFromListing(listing: string): Set<string> {
  const tables = new Set<string>();
  for (const rawLine of listing.split('\n')) {
    const match = TABLE_LINE_PATTERN.exec(rawLine.trim());
    if (match) {
      tables.add(match[1]);
    }
  }
  return tables;
}

export function findMissingExpectedTables(listing: string): string[] {
  const found = extractTableNamesFromListing(listing);
  return EXPECTED_TABLES.filter((table) => !found.has(table));
}
