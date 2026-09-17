# Logging

## Current state, honestly

The backend logs to **stdout/stderr via `console.log`/`console.error`**. There is no logging framework, no log levels, no JSON output, and no request correlation IDs.

That is a real limitation, and this document says so rather than describing an aspirational setup. It was reviewed and deliberately left as-is — the reasoning is in [What was not changed](#what-was-not-changed) below.

What the current approach does get right is the part that matters most for containers: **logs go to stdout/stderr and nothing else.** No log files, no log rotation inside the container, no writing to disk (which the read-only root filesystem would block anyway). That's the [twelve-factor](https://12factor.net/logs) behaviour — the process treats logs as a stream and the platform captures them.

## Where logs actually go

| Environment | Capture | How to read |
|---|---|---|
| Docker Compose | Docker's `json-file` driver | `docker compose logs -f backend` |
| Kubernetes | kubelet, per container | `kubectl -n foodbridge logs -f deploy/backend` |
| AWS ECS (Terraform design) | `awslogs` driver → CloudWatch Logs, 14-day retention | CloudWatch console / `aws logs tail` |

Because both images write to stdout/stderr, the same code works unchanged in all three. nginx needs no special handling either: its base image already symlinks `access.log` and `error.log` to stdout/stderr, which is why the read-only root filesystem doesn't break it.

## What gets logged today

| Event | Where | Level |
|---|---|---|
| Startup (port, environment) | `src/index.ts` | `log` |
| **Fatal config rejection** (bad `JWT_SECRET`, missing `DATABASE_URL`/`FRONTEND_URL`) | `src/config/index.ts` | `error` + `process.exit(1)` |
| Database connectivity failure | `src/app.ts` (health check) | `error` |
| Unhandled request errors | `src/app.ts` error middleware | `error` (stack) |
| Password-reset request failures | `src/controllers/auth.controller.ts` | `error` |
| Email delivery failures | `src/services/email.service.ts` | `error` |
| Graceful shutdown progress | `src/shutdown.ts` | `log` / `error` |
| HTTP access logs | nginx | stdout |

The startup config failures are the most operationally useful logs in the system: each one prints *why* it refused to start and *what to set*, then exits non-zero. A container that won't boot is easy to diagnose because the reason is the last line before the exit.

### Audit trail is in the database, not the logs

Administrative actions (user approval/rejection, donation moderation) are written to the **`AdminLog` table** inside the same transaction as the action itself, not emitted as log lines. That's a deliberate and defensible design: an audit record that commits atomically with the action it describes cannot drift out of sync with it, and it's queryable by the admin UI. Log lines can be lost, truncated, or rotated away; a database row in the same transaction cannot.

The trade-off is that this audit trail isn't visible to a log aggregator. For this application's scale that's the right call.

## What is deliberately never logged

Verified in the code, not assumed:

- **Passwords** — never logged in any form, including by the admin-provisioning script, which masks terminal input.
- **JWTs and reset tokens** — the password-reset flow is explicitly gated on `NODE_ENV`, so reset links/tokens cannot appear in production logs. A dedicated test (`backend/src/test/password-reset-token-logging.test.ts`) guards this.
- **Database connection strings** — the health check logs `error.message` only, never the error object. A Prisma connection error can embed the full `DATABASE_URL`, credentials included, so logging the object would leak the database password into stdout. This is subtle and easy to get wrong; the code comments call it out.
- **Full request bodies** — never logged, so PII in a donation or profile update doesn't end up in logs.
- **Enumerable auth outcomes** — `/auth/forgot-password` returns a generic response and logs the failure server-side only, so logs (and responses) don't reveal whether an email address is registered.

## Diagnosing the failure classes

**Application failures** — `kubectl logs` / `docker compose logs`. The error middleware prints the stack. Correlate with the Grafana **Error rate (5xx)** panel to establish scope: one request or everything?

**API errors** — the `/metrics` endpoint is better than logs for this. `http_requests_total{status_code=...}` by route tells you *which* endpoint is failing and how often; logs tell you *why*. Use the metrics to find it, the logs to explain it.

**Database failures** — `/health` returns `503` with `database: "unreachable"`, and the backend logs `[health] database connectivity check failed: <message>`. In Kubernetes this also surfaces as readiness-probe failures in `kubectl describe pod`.

**Authentication issues** — mostly *not* in the logs, by design (see above). Failed logins surface as `401` counts in metrics and as rate-limit `429`s. Genuine auth misconfiguration shows up as a startup failure instead.

**Container failures** — the container-level events are outside the app's own logs:
```bash
kubectl -n foodbridge describe pod <pod>     # OOMKilled, probe failures, exit codes
kubectl -n foodbridge logs <pod> --previous  # logs from the crashed instance
docker inspect <container> --format '{{json .State.Health}}'
```
`--previous` is the important one — after a crash-loop restart, the current container's logs are empty and the useful output is in the previous instance.

## What was not changed

No logging framework (`pino`, `winston`) was introduced, and no structured-logging migration was performed. The reasoning:

1. **It would touch application code broadly** for no operational gain at this scale. A single-instance deployment reading `docker compose logs` gets no benefit from JSON until there's an aggregator to parse it.
2. **The highest-value observability gap was metrics, not logs** — and that gap was real and has been closed (see [MONITORING.md](MONITORING.md)). Before this work there was no way to know the request rate, latency, or error rate. That's a much bigger blind spot than unstructured log lines.
3. **The risky part of logging is already correct.** The sensitive-data handling above is the part that's genuinely hard to retrofit and easy to get wrong, and it's already right — including the non-obvious connection-string case.
4. Migrating logging would have meant editing many application files, against the explicit constraint not to modify application functionality beyond what a DevOps capability requires.

## What to do when this stops being adequate

The trigger is **more than one instance plus a log aggregator** — at that point, grepping per-container logs stops scaling and unstructured lines become the bottleneck. In rough priority order:

1. **Structured JSON logging** (`pino` is the natural fit — fast, minimal, and its API is close enough to `console` that the migration is mechanical). One log line per request with method, route pattern, status, and duration.
2. **Request correlation IDs** — generate or accept `X-Request-Id` at nginx, propagate it through, and include it in every log line and error response. This is what makes a user-reported error traceable to specific log lines, and it's the single highest-value addition after JSON.
3. **Log levels** driven by a `LOG_LEVEL` env var, so production can run at `info` and a debugging session at `debug` without a code change.
4. **Aggregation** — Loki fits naturally here since Grafana is already deployed and provisioned; CloudWatch Logs Insights is the zero-extra-infrastructure option in the ECS design, which already ships logs there.
5. **Structured audit events** alongside the existing `AdminLog` rows, if compliance ever requires audit data outside the database.

Note that step 1 pairs naturally with the existing metrics work: the `route` label in `backend/src/metrics.ts` already resolves the Express route *pattern* (and collapses unmatched paths to `unmatched` for cardinality safety). The same helper is exactly what a structured access log should use as its route field — so the cardinality thinking already done for metrics carries over directly.
