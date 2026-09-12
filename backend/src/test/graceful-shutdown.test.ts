import { describe, it, expect, vi } from 'vitest';
import http from 'http';
import { createShutdownHandler } from '../shutdown.js';

// Phase 20: focused tests against the extracted shutdown handler itself
// (see shutdown.ts), not against the real process - index.ts's top-level
// app.listen()/process.on(...) wiring is never imported by any test (see
// that file's own comment), so importing this test file has no side
// effects on the test runner. Each test spins up its own throwaway
// http.Server on an ephemeral port so it can exercise the real
// server.close() behavior, not a mock of it.

function startServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.end('ok');
    });
    server.listen(0, () => resolve(server));
  });
}

describe('createShutdownHandler (Phase 20)', () => {
  it('closes the server, disconnects, and exits with code 0 on a clean shutdown', async () => {
    const server = await startServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();

    const shutdown = createShutdownHandler(server, { disconnect, exit, timeoutMs: 2000 });
    await shutdown('SIGTERM');

    expect(server.listening).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('stops accepting new connections once shutdown begins', async () => {
    const server = await startServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createShutdownHandler(server, { disconnect, exit, timeoutMs: 2000 });

    await shutdown('SIGTERM');

    expect(server.listening).toBe(false);
  });

  it('does not hang indefinitely: proceeds via the bounded timeout if the server never fully closes', async () => {
    const server = await startServer();
    // Simulate an idle keep-alive connection that never lets close()'s
    // callback fire on its own - the exact real-world scenario the
    // timeout exists for.
    const realClose = server.close.bind(server);
    vi.spyOn(server, 'close').mockImplementation(((..._args: unknown[]) => {
      // Deliberately never invoke the callback - close() is called (stops
      // accepting new connections) but its completion callback is
      // withheld, exactly like a client holding a connection open forever.
      return server;
    }) as typeof server.close);

    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const logError = vi.fn();

    const shutdown = createShutdownHandler(server, {
      disconnect,
      exit,
      logError,
      timeoutMs: 50, // short bound so this test itself stays fast
    });

    const start = Date.now();
    await shutdown('SIGTERM');
    const elapsed = Date.now() - start;

    // Proceeded via the timeout, not by waiting forever.
    expect(elapsed).toBeLessThan(2000);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('did not complete within'));

    realClose(); // actually release the port for other tests
  });

  it('a second signal while already shutting down does not disconnect/exit twice', async () => {
    const server = await startServer();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createShutdownHandler(server, { disconnect, exit, timeoutMs: 2000 });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(disconnect).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it('still calls exit(0) even if disconnect() rejects, rather than hanging or crashing', async () => {
    const server = await startServer();
    const disconnect = vi.fn().mockRejectedValue(new Error('prisma disconnect failed'));
    const exit = vi.fn();
    const logError = vi.fn();

    const shutdown = createShutdownHandler(server, { disconnect, exit, logError, timeoutMs: 2000 });
    await shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Error disconnecting'));
  });
});
