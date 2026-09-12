import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app, { checkDatabaseHealth } from '../app.js';
import prisma from '../models/prisma.js';

// Phase 20: /health previously only reported process liveness - an
// orchestrator/load balancer polling it would see "ok" even with a fully
// unreachable database. checkDatabaseHealth() is exported specifically so
// the failure path is testable by mocking prisma.$queryRaw to reject,
// rather than requiring the test suite to actually stop the real test
// Postgres instance (disruptive and flaky for CI - the phase's own
// instruction is explicit about avoiding that).

describe('GET /health (Phase 20)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('healthy: process up + real DB reachable -> 200, status ok, database ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('ok');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('unhealthy: DB query fails -> 503, status error, database unreachable', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.database).toBe('unreachable');
  });

  it('unhealthy response never exposes the underlying error, connection string, or credentials', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(
      new Error('password authentication failed for user "foodbridge_admin" at postgresql://foodbridge_admin:s3cr3t@prod-db:5432/foodbridge')
    );

    const res = await request(app).get('/health');

    const bodyText = JSON.stringify(res.body);
    expect(bodyText).not.toContain('s3cr3t');
    expect(bodyText).not.toContain('postgresql://');
    expect(bodyText).not.toContain('foodbridge_admin');
    // Only the two documented fields describe the failure - no stack, no
    // raw error message from Prisma.
    expect(Object.keys(res.body).sort()).toEqual(['database', 'status', 'timestamp', 'uptimeSeconds']);
  });
});

describe('checkDatabaseHealth (Phase 20)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when the database is reachable (real test DB)', async () => {
    await expect(checkDatabaseHealth()).resolves.toBe(true);
  });

  it('returns false, not a thrown error, when the query fails', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('simulated DB outage'));

    await expect(checkDatabaseHealth()).resolves.toBe(false);
  });
});
