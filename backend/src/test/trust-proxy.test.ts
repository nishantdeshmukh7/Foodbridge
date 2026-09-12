import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { parseTrustProxy } from '../config/index.js';

// Phase 19: express-rate-limit (see middleware/rateLimit.ts) keys its rate
// limit buckets on req.ip, which Express only derives from
// X-Forwarded-For when 'trust proxy' is configured to trust the hop that
// header claims to come from. Left at Express's default (trust proxy
// unset/false), a client-supplied X-Forwarded-For is ignored outright -
// safe, but wrong behind a real reverse proxy, where it would mean every
// real client shares one rate-limit bucket (the proxy's own IP). Configured
// too loosely (trust proxy: true), any client can put whatever IP they want
// in X-Forwarded-For and Express will believe it, defeating rate limiting
// by letting an attacker rotate through fake source IPs on every request.
//
// These tests prove both halves: with the app's default configuration
// (no TRUST_PROXY set), a spoofed header is ignored; with an explicit hop
// count configured (the documented single-reverse-proxy deployment
// assumption - see backend/.env.example and README.md's Deployment
// section), a header from the trusted hop is honored, but only up to that
// many hops.

describe('parseTrustProxy (Phase 19)', () => {
  it('defaults to false (no proxy trusted) when TRUST_PROXY is unset', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
  });

  it('defaults to false for an empty string', () => {
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
  });

  it('parses the literal "false" as false', () => {
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('parses the literal "true" as true', () => {
    expect(parseTrustProxy('true')).toBe(true);
  });

  it('parses a plain integer as a hop count (number, not string)', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('passes through anything else (specific IPs/CIDR ranges/keywords) unchanged for Express to parse', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy('203.0.113.5, 10.0.0.0/8')).toBe('203.0.113.5, 10.0.0.0/8');
  });
});

function buildWhoAmIApp(trustProxy: boolean | number | string) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/whoami', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

describe('Express req.ip resolution under different trust-proxy configurations (Phase 19)', () => {
  const spoofedIp = '203.0.113.99';

  it('default configuration (parseTrustProxy(undefined) = false): a spoofed X-Forwarded-For is ignored', async () => {
    const app = buildWhoAmIApp(parseTrustProxy(undefined));

    const res = await request(app).get('/whoami').set('X-Forwarded-For', spoofedIp);

    expect(res.status).toBe(200);
    expect(res.body.ip).not.toBe(spoofedIp);
  });

  it('TRUST_PROXY=1 (one trusted hop): X-Forwarded-For from that hop is honored', async () => {
    const app = buildWhoAmIApp(parseTrustProxy('1'));

    const res = await request(app).get('/whoami').set('X-Forwarded-For', spoofedIp);

    expect(res.status).toBe(200);
    // supertest's request arrives as a single direct hop, so with exactly
    // one trusted proxy configured, Express takes the left-most (client)
    // entry of X-Forwarded-For as req.ip.
    expect(res.body.ip).toBe(spoofedIp);
  });

  it('TRUST_PROXY=1: a second, further-out spoofed hop beyond the trusted one is not honored as the client IP', async () => {
    const app = buildWhoAmIApp(parseTrustProxy('1'));
    const realClientIp = '198.51.100.7';

    // Simulates an attacker prepending a fake entry ahead of the real
    // client IP that the trusted proxy itself appended - with only one hop
    // trusted, Express reads one entry in from the right (the proxy's own
    // append), not the attacker-controlled left-most entry.
    const res = await request(app)
      .get('/whoami')
      .set('X-Forwarded-For', `${spoofedIp}, ${realClientIp}`);

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe(realClientIp);
    expect(res.body.ip).not.toBe(spoofedIp);
  });

  it('TRUST_PROXY=false explicitly: same as the default, spoofed header ignored', async () => {
    const app = buildWhoAmIApp(parseTrustProxy('false'));

    const res = await request(app).get('/whoami').set('X-Forwarded-For', spoofedIp);

    expect(res.status).toBe(200);
    expect(res.body.ip).not.toBe(spoofedIp);
  });
});
