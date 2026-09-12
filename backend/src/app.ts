import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import prisma from './models/prisma.js';
import authRoutes from './routes/auth.routes.js';
import donationRoutes from './routes/donation.routes.js';
import pickupRoutes from './routes/pickup.routes.js';
import userRoutes from './routes/user.routes.js';
import adminRoutes from './routes/admin.routes.js';
import notificationRoutes from './routes/notification.routes.js';

// Builds the Express app without starting a listener, so it can be imported
// directly by tests (supertest) as well as by the real bootstrap (index.ts).

const app = express();

// Phase 19: without this, express-rate-limit (see middleware/rateLimit.ts)
// keys on req.ip, and Express's default ('trust proxy' unset) ignores
// X-Forwarded-For entirely - so behind a real reverse proxy every request
// would resolve to the proxy's own IP, collapsing all real clients into one
// shared rate-limit bucket. config.trustProxy defaults to false (no proxy
// trusted) unless TRUST_PROXY is explicitly set - see config/index.ts and
// backend/.env.example.
app.set('trust proxy', config.trustProxy);

app.use(helmet());
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));
app.use(express.json());

// Phase 20: the process being up and Postgres being reachable are two
// different facts - this used to only report the first one, so an
// orchestrator/load balancer polling /health would see "ok" even with a
// fully unreachable database. Exported so it's directly testable (mock
// prisma.$queryRaw to simulate a DB failure) without needing to actually
// stop the test database.
//
// SELECT 1 rather than any real table: cheapest possible round-trip that
// still proves the connection pool can reach and query Postgres, with
// zero table-shape coupling.
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    // Server-side only, and never the error object itself - a Prisma
    // connection error can embed the connection string (credentials
    // included). Logging just the fact of a failure is enough for an
    // operator to go look at the database; the client response below
    // never sees any of this.
    console.error('[health] database connectivity check failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

// uptimeSeconds is process.uptime() - a real, cheap, genuinely-truthful
// fact (this Node process has been running this long since its last
// restart) - not the fabricated "99.9%" SLA-style figure the old Admin
// Monitoring page used to show. Public and unauthenticated, like any
// standard health endpoint; the Admin Monitoring page reads it too rather
// than inventing its own uptime number.
app.get('/health', async (req, res) => {
  const databaseHealthy = await checkDatabaseHealth();
  const status = databaseHealthy ? 'ok' : 'error';

  res.status(databaseHealthy ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    database: databaseHealthy ? 'ok' : 'unreachable',
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/pickups', pickupRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // express.json() rejects malformed bodies by throwing here - that is a
  // client error (400), not a server fault, and must not fall through to
  // the generic 500 below.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Malformed JSON in request body' });
    return;
  }

  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
