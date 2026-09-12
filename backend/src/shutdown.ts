import type { Server } from 'http';

// Phase 20: extracted from index.ts so it can be imported and tested
// directly without triggering index.ts's own top-level app.listen() call -
// importing this module has no side effects on its own.
//
// server.close(callback)'s callback only fires once every existing
// connection has closed - including idle keep-alive sockets a client never
// explicitly closes, which is a well-known way for this to hang
// indefinitely on its own. The bounded timeout below exists specifically
// for that case: whichever finishes first (every connection actually
// drained, or the timeout) is what we proceed on, so shutdown always
// completes in bounded time either way.
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ShutdownOptions {
  disconnect?: () => Promise<unknown>;
  exit?: (code: number) => void;
  timeoutMs?: number;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export function createShutdownHandler(server: Server, options: ShutdownOptions = {}) {
  const disconnect = options.disconnect ?? (async () => {});
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const log = options.log ?? ((message: string) => console.log(message));
  const logError = options.logError ?? ((message: string) => console.error(message));

  let shuttingDown = false;

  return async function shutdown(signal: string): Promise<void> {
    // A second SIGTERM/SIGINT (some process managers send more than one)
    // while a shutdown is already in progress must not start a second,
    // overlapping shutdown sequence - it would call disconnect()/exit()
    // twice for no benefit.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    log(`${signal} received: shutting down gracefully...`);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const closeServer = new Promise<void>((resolve) => {
      // Stops accepting new connections immediately; resolves once every
      // existing connection has closed (in-flight requests get a chance
      // to finish normally).
      server.close(() => resolve());
    });

    const timeout = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => {
        logError(`Shutdown did not complete within ${timeoutMs}ms - proceeding without waiting further.`);
        resolve();
      }, timeoutMs);
      // Never the reason the process stays alive on its own - only ever a
      // bound on how long we wait, not a keep-alive.
      timeoutHandle.unref?.();
    });

    await Promise.race([closeServer, timeout]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    try {
      await disconnect();
    } catch (error) {
      logError(`Error disconnecting from the database during shutdown: ${error instanceof Error ? error.message : error}`);
    }

    exit(0);
  };
}
