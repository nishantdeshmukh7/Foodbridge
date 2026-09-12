import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../app.js';
import prisma from '../models/prisma.js';
import { userService } from '../services/user.service.js';

// Phase 20: userService.createAdmin() backs backend/scripts/create-admin.ts,
// the sanctioned way to provision a second administrator without direct
// database access and without reopening public ADMIN registration. These
// tests exercise the service function directly against the real test
// database (the same convention every other service test in this suite
// uses) - the CLI script itself is I/O glue (prompts/env var reading) with
// no independent logic to test, same as prisma/seed.ts.
//
// Email prefix is distinct from the shared "@test.foodbridge.local" suffix
// convention every other test file uses - this file's cleanup scopes on
// that prefix alone (rather than the generic shared suffix) specifically
// to avoid colliding with other, concurrently-run test files' still-live
// Donation rows that reference users sharing the generic suffix (a plain
// User.deleteMany() on the generic suffix hit a FK constraint violation
// against another file's donations during development of this test).
// None of the users this file creates ever own a Donation, so this file's
// own cleanup never needs FK-ordered deletes the way donation-related
// test files do.
const EMAIL_PREFIX = 'phase20-admin-provisioning-';
const emailFor = (name: string) => `${EMAIL_PREFIX}${name}@test.foodbridge.local`;

describe('Phase 20: userService.createAdmin (second-admin provisioning)', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates an ADMIN account that is pre-approved and active', async () => {
    const email = emailFor('new-1');
    const admin = await userService.createAdmin({
      email,
      name: 'Provisioned Admin',
      password: 'a-real-password-123',
    });

    expect(admin.role).toBe('ADMIN');
    expect(admin.isApproved).toBe(true);
    expect(admin.isActive).toBe(true);
    expect(admin.email).toBe(email);
  });

  it('never returns the password hash in the result', async () => {
    const admin = await userService.createAdmin({
      email: emailFor('new-2'),
      name: 'Provisioned Admin 2',
      password: 'a-real-password-123',
    });

    expect(admin).not.toHaveProperty('password');
  });

  it('hashes the password with the same mechanism/cost as normal registration (bcrypt, verifiable via bcrypt.compare)', async () => {
    const email = emailFor('new-3');
    await userService.createAdmin({ email, name: 'Provisioned Admin 3', password: 'correct-horse-battery' });

    const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(stored.password.startsWith('$2')).toBe(true); // bcrypt hash format
    expect(stored.password).not.toBe('correct-horse-battery'); // never stored raw
    await expect(bcrypt.compare('correct-horse-battery', stored.password)).resolves.toBe(true);
    await expect(bcrypt.compare('wrong-password', stored.password)).resolves.toBe(false);
  });

  it('fails safely and does not overwrite an existing account with the same email', async () => {
    const email = emailFor('existing-user');
    const original = await prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash('original-password', 4),
        name: 'Original Donor',
        role: 'DONOR',
        isApproved: true,
        isActive: true,
      },
    });

    await expect(
      userService.createAdmin({ email, name: 'Attempted Admin Takeover', password: 'new-password-123' })
    ).rejects.toThrow('already exists');

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(unchanged.role).toBe('DONOR'); // still a donor, not silently promoted
    expect(unchanged.name).toBe('Original Donor'); // not overwritten
    expect(unchanged.password).toBe(original.password); // password untouched
  });

  it('fails safely against an existing ADMIN account too - does not silently reset its password', async () => {
    const email = emailFor('existing-admin');
    const originalHash = await bcrypt.hash('original-admin-password', 4);
    await prisma.user.create({
      data: {
        email,
        password: originalHash,
        name: 'Existing Admin',
        role: 'ADMIN',
        isApproved: true,
        isActive: true,
      },
    });

    await expect(
      userService.createAdmin({ email, name: 'New Name', password: 'a-different-password' })
    ).rejects.toThrow('already exists');

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(unchanged.password).toBe(originalHash);
    expect(unchanged.name).toBe('Existing Admin');
  });

  it('a provisioned admin can actually log in through the real HTTP login route', async () => {
    const email = emailFor('login-check');
    await userService.createAdmin({ email, name: 'Login Check Admin', password: 'real-login-password-1' });

    const res = await request(app).post('/api/auth/login').send({ email, password: 'real-login-password-1' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.token).toBeTruthy();
  });

  it('public registration still cannot create ADMIN, independent of this new provisioning path existing', async () => {
    const email = emailFor('attempted-public-admin');
    const res = await request(app).post('/api/auth/register').send({
      email,
      password: 'password123',
      name: 'Attempted Public Admin',
      role: 'ADMIN',
    });

    // Either the validator rejects the role outright, or the service does
    // - either way, no ADMIN account results.
    expect(res.status).toBe(400);
    const created = await prisma.user.findUnique({ where: { email } });
    expect(created).toBeNull();
  });
});
