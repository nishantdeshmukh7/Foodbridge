import app from './app.js';
import { config } from './config/index.js';
import prisma from './models/prisma.js';
import { createShutdownHandler } from './shutdown.js';

// Bound to 0.0.0.0 (not the default) so external connections reach the
// process on hosts like Back4app that route to the container over a
// non-loopback interface.
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

// Phase 20: without this, a container orchestrator's SIGTERM (the normal
// signal sent before a redeploy/scale-down kills the process) hard-kills
// in-flight requests immediately instead of letting them finish, and never
// closes the Prisma connection pool cleanly. See shutdown.ts for the
// bounded-timeout logic that keeps this from hanging indefinitely if a
// client holds a keep-alive connection open.
const shutdown = createShutdownHandler(server, {
  disconnect: () => prisma.$disconnect(),
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
