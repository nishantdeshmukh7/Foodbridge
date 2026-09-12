import { describe, it, expect } from 'vitest';
import {
  resolveBackupConfig,
  parseDatabaseUrl,
  buildBackupFilename,
  parseBackupTimestamp,
  buildPgDumpArgs,
  buildPgRestoreListArgs,
  buildPgRestoreArgs,
  selectBackupsToDelete,
  extractTableNamesFromListing,
  findMissingExpectedTables,
  EXPECTED_TABLES,
  type BackupFileInfo,
} from '../backup/lib.js';

// Phase 26: unit tests for the pure logic behind the backup/verify/restore
// CLI scripts (backend/scripts/backup/). None of these spawn a real
// pg_dump/pg_restore process or touch a real filesystem/database - that
// end-to-end proof is the separate, actually-performed disaster-recovery
// drill (see the Phase 26 report), not something the automated suite
// depends on.

describe('resolveBackupConfig', () => {
  it('rejects a missing DATABASE_URL', () => {
    expect(() => resolveBackupConfig({})).toThrow('DATABASE_URL is not set');
  });

  it('rejects a DATABASE_URL with no recognizable Postgres scheme', () => {
    expect(() => resolveBackupConfig({ DATABASE_URL: 'mysql://user:pass@host/db' })).toThrow(
      'does not look like a valid PostgreSQL connection string'
    );
  });

  it('applies sensible defaults when only DATABASE_URL is set', () => {
    const config = resolveBackupConfig({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/foodbridge' });
    expect(config.retentionDailyCount).toBe(7);
    expect(config.retentionWeeklyCount).toBe(4);
    expect(config.backupDir).toContain('backups');
  });

  it('honors an explicit BACKUP_DIR and retention overrides', () => {
    const config = resolveBackupConfig({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/foodbridge',
      BACKUP_DIR: '/mnt/external-backups',
      BACKUP_RETENTION_DAILY_COUNT: '3',
      BACKUP_RETENTION_WEEKLY_COUNT: '2',
    });
    expect(config.backupDir).toBe('/mnt/external-backups');
    expect(config.retentionDailyCount).toBe(3);
    expect(config.retentionWeeklyCount).toBe(2);
  });

  it('rejects a negative or non-numeric retention value', () => {
    const base = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/foodbridge' };
    expect(() => resolveBackupConfig({ ...base, BACKUP_RETENTION_DAILY_COUNT: '-1' })).toThrow(
      'BACKUP_RETENTION_DAILY_COUNT must be a non-negative integer'
    );
    expect(() => resolveBackupConfig({ ...base, BACKUP_RETENTION_WEEKLY_COUNT: 'abc' })).toThrow(
      'BACKUP_RETENTION_WEEKLY_COUNT must be a non-negative integer'
    );
  });

  it('never echoes the DATABASE_URL value in a thrown error message', () => {
    const sensitiveUrl = 'mysql://admin:SuperSecretPassword123@prod-db.internal:3306/foodbridge';
    try {
      resolveBackupConfig({ DATABASE_URL: sensitiveUrl });
      expect.fail('expected resolveBackupConfig to throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('SuperSecretPassword123');
      expect(message).not.toContain(sensitiveUrl);
    }
  });
});

describe('parseDatabaseUrl', () => {
  it('parses host/port/user/password/database out of a well-formed URL', () => {
    const conn = parseDatabaseUrl('postgresql://myuser:mypass@db.example.com:5433/foodbridge');
    expect(conn).toEqual({
      host: 'db.example.com',
      port: '5433',
      user: 'myuser',
      password: 'mypass',
      database: 'foodbridge',
    });
  });

  it('defaults port to 5432 when omitted', () => {
    const conn = parseDatabaseUrl('postgresql://myuser:mypass@db.example.com/foodbridge');
    expect(conn.port).toBe('5432');
  });

  it('URL-decodes a percent-encoded password', () => {
    const conn = parseDatabaseUrl('postgresql://myuser:p%40ssw0rd%21@db.example.com/foodbridge');
    expect(conn.password).toBe('p@ssw0rd!');
  });

  it('throws if the database name is missing', () => {
    expect(() => parseDatabaseUrl('postgresql://myuser:mypass@db.example.com/')).toThrow(
      'missing a host or database name'
    );
  });
});

describe('buildBackupFilename / parseBackupTimestamp', () => {
  it('round-trips a timestamp through the filename and back', () => {
    const now = new Date(2026, 2, 5, 14, 30, 9); // local time, matches buildBackupFilename's own use of local getters
    const filename = buildBackupFilename(now);
    expect(filename).toBe('foodbridge-20260305-143009.dump');
    expect(parseBackupTimestamp(filename)).toEqual(now);
  });

  it('returns null for a filename that does not match this script\'s own shape', () => {
    expect(parseBackupTimestamp('foodbridge-20260305-143009.dump.tmp')).toBeNull();
    expect(parseBackupTimestamp('some-other-file.dump')).toBeNull();
    expect(parseBackupTimestamp('.DS_Store')).toBeNull();
  });
});

describe('pg_dump / pg_restore command construction', () => {
  const conn = { host: 'db.example.com', port: '5432', user: 'myuser', password: 'top-secret-password', database: 'foodbridge' };

  it('builds pg_dump args with -Fc and never includes the password', () => {
    const args = buildPgDumpArgs(conn, '/backups/foo.dump.tmp');
    expect(args).toEqual(['-h', 'db.example.com', '-p', '5432', '-U', 'myuser', '-d', 'foodbridge', '-Fc', '-f', '/backups/foo.dump.tmp']);
    expect(args.join(' ')).not.toContain('top-secret-password');
  });

  it('builds a pg_restore --list command that needs only the file path, no connection info at all', () => {
    const args = buildPgRestoreListArgs('/backups/foo.dump');
    expect(args).toEqual(['--list', '/backups/foo.dump']);
  });

  it('builds pg_restore args with --clean --if-exists and never includes the password', () => {
    const args = buildPgRestoreArgs(conn, '/backups/foo.dump');
    expect(args).toEqual([
      '--clean',
      '--if-exists',
      '-h',
      'db.example.com',
      '-p',
      '5432',
      '-U',
      'myuser',
      '-d',
      'foodbridge',
      '/backups/foo.dump',
    ]);
    expect(args.join(' ')).not.toContain('top-secret-password');
  });
});

describe('selectBackupsToDelete', () => {
  function backup(daysAgo: number): BackupFileInfo {
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    return { filename: `backup-${daysAgo}d-ago.dump`, createdAt };
  }

  it('keeps everything when there are fewer backups than the daily budget', () => {
    const files = [backup(0), backup(1), backup(2)];
    expect(selectBackupsToDelete(files, 7, 4)).toEqual([]);
  });

  it('keeps the most recent `dailyCount` unconditionally', () => {
    const files = [backup(0), backup(1), backup(2), backup(3)];
    const toDelete = selectBackupsToDelete(files, 2, 0);
    expect(toDelete.sort()).toEqual(['backup-2d-ago.dump', 'backup-3d-ago.dump'].sort());
  });

  it('keeps at most one backup per week for the weekly tier, beyond the daily tier', () => {
    // 0 days ago (daily), then one from each of the last 5 distinct weeks.
    const files = [backup(0), backup(10), backup(17), backup(24), backup(31), backup(38)];
    const toDelete = selectBackupsToDelete(files, 1, 3);
    // Daily tier keeps day 0. Weekly tier keeps the next 3 distinct weeks
    // (10, 17, 24 days ago land in 3 different week buckets) - 31 and 38
    // days ago fall outside the weekly budget and should be pruned.
    expect(toDelete.sort()).toEqual(['backup-31d-ago.dump', 'backup-38d-ago.dump'].sort());
  });

  it('deletes everything once both budgets are set to zero', () => {
    const files = [backup(0), backup(1)];
    const toDelete = selectBackupsToDelete(files, 0, 0);
    expect(toDelete.sort()).toEqual(['backup-0d-ago.dump', 'backup-1d-ago.dump'].sort());
  });

  it('only keeps one backup per week bucket even if several land in the same week', () => {
    // Two backups 10 and 11 days ago likely fall in the same week bucket.
    const files = [backup(0), backup(10), backup(11)];
    const toDelete = selectBackupsToDelete(files, 1, 1);
    // Exactly one of the two week-10/11 backups is kept; the other is pruned.
    expect(toDelete).toHaveLength(1);
    expect(['backup-10d-ago.dump', 'backup-11d-ago.dump']).toContain(toDelete[0]);
  });
});

describe('extractTableNamesFromListing / findMissingExpectedTables', () => {
  const REALISTIC_LISTING = `;
; Archive created at 2026-03-05 14:30:09 UTC
;     dbname: foodbridge
;     TOC Entries: 12
;     Compression: -1
;     Dump Version: 1.14-0
;     Format: CUSTOM
;     Integer: 4 bytes
;     Offset: 8 bytes
;     Dumped from database version: 15.4
;     Dumped by pg_dump version: 15.4
;
;
; Selected TOC Entries:
;
3421; 1259 24601 TABLE public User someowner
3422; 1259 24602 TABLE public Donation someowner
3423; 1259 24603 TABLE public PickupRequest someowner
3424; 1259 24604 TABLE public Delivery someowner
3425; 1259 24605 TABLE public AdminLog someowner
3426; 1259 24606 TABLE public Notification someowner
3427; 1259 24607 TABLE public Verification someowner
3428; 1259 24608 TABLE public PasswordResetToken someowner
3429; 1259 24609 TABLE public _prisma_migrations someowner
`;

  it('extracts every TABLE entry from a realistic pg_restore --list output', () => {
    const tables = extractTableNamesFromListing(REALISTIC_LISTING);
    for (const expected of EXPECTED_TABLES) {
      expect(tables.has(expected)).toBe(true);
    }
    expect(tables.has('_prisma_migrations')).toBe(true);
  });

  it('reports no missing tables for a complete backup', () => {
    expect(findMissingExpectedTables(REALISTIC_LISTING)).toEqual([]);
  });

  it('reports exactly which expected tables are missing from an incomplete backup', () => {
    const incomplete = REALISTIC_LISTING.split('\n')
      .filter((line) => !line.includes('AdminLog') && !line.includes('Notification'))
      .join('\n');
    expect(findMissingExpectedTables(incomplete).sort()).toEqual(['AdminLog', 'Notification'].sort());
  });

  it('ignores non-TABLE entries (e.g. sequences, indexes, constraints)', () => {
    const listing = `3430; 1259 24610 SEQUENCE public User_id_seq someowner
3431; 2606 24611 CONSTRAINT public User User_pkey someowner`;
    expect(extractTableNamesFromListing(listing).size).toBe(0);
  });
});
