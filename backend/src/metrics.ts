import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

// Application-level Prometheus metrics. Before this existed, the local
// monitoring stack (docker-compose.yml's prometheus/grafana/cadvisor) could
// only answer container-level questions - "how much CPU is this container
// using" - and had no way to answer the questions that actually matter for
// an API's health: how many requests, how slow, how many errors. cAdvisor
// cannot know any of that; only the app itself can.
//
// A dedicated Registry rather than prom-client's global default one, so a
// test can construct/inspect metrics in isolation without state leaking
// between test files (see src/test/metrics.test.ts).
export const registry = new Registry();

registry.setDefaultLabels({ app: 'foodbridge-backend' });

// Node/process-level metrics prom-client derives itself: event-loop lag,
// heap usage, GC pauses, open handles. These are genuinely useful for
// diagnosing "the API got slow but CPU looks fine" (usually event-loop
// blocking or a memory leak) and cost nothing to collect.
collectDefaultMetrics({ register: registry });

// Labeled by method/route/status_code, NOT by full URL path. Using the
// Express route pattern ('/api/donations/:id') rather than the concrete
// URL ('/api/donations/clx7a9...') is essential, not cosmetic: a label
// whose value is unbounded (one per donation id) creates one time series
// per distinct value and will eventually exhaust Prometheus's memory -
// the classic "cardinality explosion" failure. See getRouteLabel() below.
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds.',
  labelNames: ['method', 'route', 'status_code'],
  // Tuned for a normal JSON API's latency profile, not prom-client's
  // defaults - most requests here should land in the 5-100ms range, and
  // bcrypt-bearing auth requests (deliberately slow by design) in the
  // 100-500ms range, so the buckets need resolution in both places.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests.',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

// req.route is only populated once Express has matched a route, and is
// undefined for 404s and for errors thrown before routing completes.
// Falling back to the literal string 'unmatched' (rather than req.path)
// is the cardinality-safe choice: an unmatched path is attacker-
// controllable, so using it as a label value would let anyone create
// unbounded time series just by requesting random URLs.
function getRouteLabel(req: Request): string {
  const route = req.route?.path;
  if (!route) return 'unmatched';

  // baseUrl is the mount prefix ('/api/donations'), route.path the
  // remainder ('/:id') - joined, that's the full route pattern.
  return `${req.baseUrl}${route === '/' ? '' : route}` || 'unmatched';
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Deliberately not measuring /metrics itself - a scrape every 15s would
  // otherwise dominate the request-count series and tell us nothing.
  if (req.path === '/metrics') {
    next();
    return;
  }

  const stopTimer = httpRequestDuration.startTimer();

  // 'finish' fires once the response has been fully flushed to the socket,
  // which is the only point at which the real status code and full
  // duration are both known.
  res.on('finish', () => {
    const labels = {
      method: req.method,
      route: getRouteLabel(req),
      status_code: String(res.statusCode),
    };
    stopTimer(labels);
    httpRequestTotal.inc(labels);
  });

  next();
}
