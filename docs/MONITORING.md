# Monitoring

## The three layers, and why all three exist

Monitoring here is deliberately split across three sources, because each one can answer questions the others structurally cannot:

| Layer | Source | Answers | Cannot answer |
|---|---|---|---|
| **Application** | `backend/src/metrics.ts` → `GET /metrics` | How many requests? How slow? How many failed? Is the Node event loop blocked? | Anything about the container or host it runs in |
| **Container** | cAdvisor | Is this container CPU-throttled or near its memory limit? | Whether the API is returning errors — it cannot see inside the process |
| **Host** | `node_exporter` (installed by `ansible/roles/node_exporter`) | Is the VM out of disk/memory? What's the load average? | Which container or request caused it |

Before this work, only the container layer existed — Prometheus scraped cAdvisor and nothing else. That meant the stack could tell you a container was using 40% CPU but had no way to tell you the API was returning 500s. That gap is what the application layer closes.

## Application metrics (`/metrics`)

Implemented with `prom-client` in `backend/src/metrics.ts`, exposed at `GET /metrics`, registered in `backend/src/app.ts` before the routes.

**What's exported:**

- `http_requests_total{method, route, status_code}` — counter
- `http_request_duration_seconds{method, route, status_code}` — histogram, buckets tuned for this API's real latency profile (5ms–5s; resolution both in the 5–100ms normal range and the 100–500ms bcrypt-bearing auth range)
- prom-client's default Node/process metrics — event-loop lag, heap size, GC pauses, open file descriptors, process uptime

**The one thing that matters most here: label cardinality.**

The `route` label is the *Express route pattern* (`/api/donations/:id`), never the concrete URL (`/api/donations/clx7a9zzz...`). Prometheus creates one time series per distinct label-value combination, so labeling by concrete URL would create one series per donation and eventually exhaust Prometheus's memory. This failure is silent and gradual, which is what makes it dangerous.

The same reasoning applies to unmatched paths: a request to a URL that matches no route is labeled `route="unmatched"`, **not** the requested path — otherwise anyone could create unlimited time series just by requesting random URLs. Both behaviors are covered by real tests in `backend/src/test/metrics.test.ts`.

`/metrics` itself is excluded from measurement — a scrape every 15s would otherwise dominate the request counts and tell you nothing.

### Why `/metrics` is not exposed publicly

`/metrics` is unauthenticated (a scraper is infrastructure, not a user — same as `/health`), but unlike `/health` it **must not be publicly reachable**. It exposes internal route names, traffic volumes, error rates and process internals. That's reconnaissance material, even though it contains no user data and no secrets (verified by a test that asserts no connection string, JWT secret, or password material appears in the output).

It stays private structurally rather than by access control:

- **Docker Compose** — `nginx.conf` proxies only `/api` and `/health`. It deliberately does **not** proxy `/metrics`, so the endpoint is reachable only on the internal Compose network, which is exactly where Prometheus runs.
- **Kubernetes** — same: the Ingress routes to the frontend Service, and nginx doesn't forward `/metrics`. The backend Service is `ClusterIP`, so `/metrics` is cluster-internal only.
- **AWS (Terraform target)** — the ALB listener rule forwards only `/api/*` and `/health` to the backend target group. `/metrics` matches no rule and is therefore never routed from the internet.

## Running the stack

```bash
# GRAFANA_ADMIN_PASSWORD has no default by design - set it in a local,
# gitignored .env file first (see the repo root .env handling).
echo 'GRAFANA_ADMIN_PASSWORD=<pick-something>' >> .env

docker compose up -d --build
```

| Service | URL | Notes |
|---|---|---|
| Frontend | http://localhost:5174 | |
| Backend | http://localhost:4000 | `/health`, `/metrics` |
| Prometheus | http://localhost:9090 | loopback-bound |
| Grafana | http://localhost:3000 | loopback-bound, login `admin` / your `GRAFANA_ADMIN_PASSWORD` |
| cAdvisor | http://localhost:8080 | loopback-bound |

All four monitoring ports bind to `127.0.0.1` only — running this compose file on a cloud VM does not expose Grafana to the internet.

## Grafana: provisioned, not hand-clicked

`monitoring/grafana/provisioning/` is mounted read-only into the Grafana container, so the Prometheus datasource and the **FoodBridge — Service Overview** dashboard exist automatically on first start. The dashboard JSON lives in git (`monitoring/grafana/dashboards/foodbridge-overview.json`) and is the source of truth — recreating the `grafana_data` volume loses nothing.

Dashboard panels:

| Panel | Query intent |
|---|---|
| Backend up | `up{job="foodbridge-backend"}` — is the scrape succeeding at all |
| Process uptime | Resets to ~0 repeatedly ⇒ crash-looping container |
| Request rate | `sum(rate(http_requests_total[5m]))` |
| **Error rate (5xx)** | The single most important number — the one that means users see failures. 4xx is excluded deliberately: a 401/404 is usually a client problem, not a broken service |
| Event-loop lag (p99) | Node is single-threaded; sustained lag ⇒ requests queueing behind synchronous work, which shows up as latency even when CPU looks fine |
| Request rate by route | Per-route traffic |
| Latency p50/p95/p99 | From the histogram. p95/p99 matter more than the mean — an average hides the slow tail users actually complain about |
| Responses by status code | Separates a 4xx spike (auth/client issues) from a 5xx spike (service failing) |
| Node heap used/total | Heap that never drops after GC ⇒ leak ⇒ eventual OOM kill against the container memory limit |
| Container CPU / memory | cAdvisor — correlate app latency with actual CPU throttling (see macOS caveat below) |

## Verified working

Confirmed against the real running stack, not assumed:

```
$ curl -s http://localhost:9090/api/v1/targets     # all three targets
cadvisor            http://cadvisor:8080/metrics    health=up
foodbridge-backend  http://backend:3001/metrics     health=up
prometheus          http://localhost:9090/metrics   health=up

$ # p95 latency by route, after sustained traffic
route=/health          p95=43.75 ms
route=/api/donations   p95=45.99 ms

$ # route labels are patterns, and unmatched paths are collapsed
http_requests_total{route="/health",status_code="200"}         5
http_requests_total{route="/api/donations",status_code="200"}  1
http_requests_total{route="unmatched",status_code="404"}       1
```

Grafana's provisioned datasource was also verified end-to-end by querying p95 **through Grafana's own datasource proxy**, not just by checking the dashboard loaded.

## Known limitation: cAdvisor container names on Docker Desktop for Mac

**On macOS, the two cAdvisor panels will be empty.** This is a platform limitation, not a misconfiguration, and is stated here rather than papered over.

cAdvisor resolves container *names* by talking to the container runtime. On Docker Desktop for Mac it cannot: the Docker daemon and containerd run inside a Linux VM, and containerd's socket (`/run/containerd/containerd.sock`) is not exposed to the macOS host. Verified directly from the container's own logs:

```
Registration of the docker container factory failed: unable to create containerd
client: containerd: cannot unix dial containerd api service: dial unix
/run/containerd/containerd.sock: connect: no such file or directory
```

The result is that cAdvisor emits only `id` (the cgroup path) and no `name`/`image` labels, so `container_cpu_usage_seconds_total{name=~"foodbridge-.*"}` matches nothing. Mounting `/var/run/docker.sock` explicitly was tested and moves the error one step forward but does not fix it, so it was **not** added to `docker-compose.yml` — it would be config that looks like a fix while changing nothing.

The panels keep the `name`-based queries because those are correct on a Linux host (and in CI), which is where this stack would genuinely run. On macOS the same data is still available, keyed by cgroup id instead:

```promql
sum(rate(container_cpu_usage_seconds_total{id=~"/docker/.+"}[5m])) by (id)
```

Application-level metrics and all Node/process panels are completely unaffected on macOS — those come from the backend itself, not cAdvisor.

## Alerting

No alerting rules are configured, and this is a deliberate scope decision rather than an oversight. Alerts are only meaningful when there's somewhere for them to go (PagerDuty, Opsgenie, an email/Slack receiver) and someone on the other end. Shipping alert rules that fire into a void would be configuration theatre.

The metrics needed for the obvious first rules already exist, so adding them later is a small change to a `rule_files:` entry in `prometheus.yml` plus an Alertmanager service:

```yaml
# Illustrative - not currently active.
- alert: HighErrorRate
  expr: |
    sum(rate(http_requests_total{status_code=~"5.."}[5m]))
      / sum(rate(http_requests_total[5m])) > 0.05
  for: 5m

- alert: BackendDown
  expr: up{job="foodbridge-backend"} == 0
  for: 2m

- alert: HighLatency
  expr: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 1
  for: 10m
```

## Monitoring in Kubernetes

The K8s manifests do **not** deploy a second Prometheus/Grafana stack. Standing up a duplicate monitoring stack to prove the same `/metrics` endpoint works would be complexity without benefit.

The endpoint is already scrape-ready in-cluster. A Prometheus running in the cluster (via kube-prometheus-stack, typically) discovers it either through pod annotations:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "3001"
    prometheus.io/path: "/metrics"
```

or, with the Prometheus Operator installed, a `ServiceMonitor` selecting the existing `backend` Service on port 3001. Both work against the manifests exactly as they are — no application or manifest change required.

## Troubleshooting

**A Prometheus target shows `health=down`.** Check `http://localhost:9090/targets` for the actual scrape error. If it's the backend, confirm the container is up (`docker compose ps`) and that `/metrics` responds from *inside* the network: `docker compose exec prometheus wget -qO- http://backend:3001/metrics | head`.

**Grafana panels are empty but Prometheus has data.** Usually the time range — the default is `now-1h`, and a freshly started stack has only a few minutes of data. Also confirm the datasource resolved: Grafana → Connections → Data sources → Prometheus → *Save & test*.

**`histogram_quantile(...)` returns `NaN`.** Expected with too little traffic. `rate()` needs at least two samples inside the window, so a single burst of requests produces `NaN` until a couple of scrape intervals have passed. Generate sustained traffic and wait ~30s.

**Grafana won't start.** `GRAFANA_ADMIN_PASSWORD` is required with no default (deliberate — it previously defaulted to the literal `admin`). Compose interpolates *every* service's environment before filtering to the services you asked for, so this must be set even when starting only `db`/`backend`/`frontend`. Put it in a local `.env` (gitignored).

**Port 8080 already in use.** cAdvisor binds `127.0.0.1:8080`. Find the holder with `lsof -nP -iTCP:8080 -sTCP:LISTEN` and either stop it or map cAdvisor elsewhere with a local override file.
