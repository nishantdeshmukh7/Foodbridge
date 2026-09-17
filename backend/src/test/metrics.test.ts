import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

// Covers the two things that can actually go wrong with a metrics
// endpoint, rather than merely asserting it returns 200:
//   1. cardinality safety - the route label must be the Express route
//      PATTERN, never a concrete URL containing an id, and never an
//      attacker-supplied unmatched path. Getting this wrong doesn't fail
//      loudly; it quietly grows Prometheus's memory until it dies.
//   2. no secret/PII leakage - /metrics is unauthenticated, so anything
//      that ends up in a label value is effectively public to anyone who
//      can reach the endpoint.

describe('GET /metrics', () => {
  it('serves Prometheus text format with the default process metrics', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    // A few of prom-client's default metrics - these prove
    // collectDefaultMetrics() is actually registered, not just that the
    // endpoint responds.
    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toContain('nodejs_eventloop_lag_seconds');
  });

  it('counts requests and records durations for a matched route', async () => {
    await request(app).get('/health');

    const res = await request(app).get('/metrics');

    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toMatch(/http_requests_total\{[^}]*route="\/health"[^}]*\}/);
  });

  it('labels an unmatched path as "unmatched" rather than echoing the requested URL', async () => {
    // If this ever regressed to labeling by req.path, anyone could create
    // unlimited Prometheus time series just by requesting random URLs.
    await request(app).get('/this-route-does-not-exist-9f3a');

    const res = await request(app).get('/metrics');

    expect(res.text).not.toContain('this-route-does-not-exist-9f3a');
    expect(res.text).toMatch(/route="unmatched"/);
  });

  it('labels a parameterised route by its pattern, not the concrete id', async () => {
    // A real cuid-shaped id. The series must be keyed on '/api/donations/:id'
    // so that N donations produce 1 time series, not N.
    const fakeId = 'clx7a9zzz000008l3abcd1234';
    await request(app).get(`/api/donations/${fakeId}`);

    const res = await request(app).get('/metrics');

    expect(res.text).not.toContain(fakeId);
  });

  it('does not measure /metrics itself', async () => {
    await request(app).get('/metrics');
    const res = await request(app).get('/metrics');

    expect(res.text).not.toMatch(/route="\/metrics"/);
  });

  it('exposes no secrets - no JWT secret, database URL, or password material', async () => {
    const res = await request(app).get('/metrics');

    expect(res.text).not.toContain('postgresql://');
    expect(res.text).not.toContain('JWT_SECRET');
    expect(res.text.toLowerCase()).not.toContain('password');
    if (process.env.JWT_SECRET) {
      expect(res.text).not.toContain(process.env.JWT_SECRET);
    }
  });
});
