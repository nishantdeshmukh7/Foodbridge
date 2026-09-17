# Architecture

## What the application is

FoodBridge coordinates surplus-food donation: donors post food, NGOs claim it, volunteers pick it up and deliver it, admins moderate. Four roles (`DONOR`, `NGO`, `VOLUNTEER`, `ADMIN`), JWT auth, PostgreSQL via Prisma.

## Components

| Component | Technology | Port | Stateless? |
|---|---|---|---|
| Frontend | React 18 + TypeScript, built by Vite, served by nginx | 8080 (container) | Yes |
| Backend | Node.js 20 + Express 4 + TypeScript, Prisma ORM | 3001 | Yes |
| Database | PostgreSQL 15 | 5432 | **No** — the only stateful component |

The frontend is a static bundle: `npm run build` emits plain HTML/JS/CSS that nginx serves. There is no server-side rendering and no Node process in the frontend container at runtime.

Both application tiers are stateless, which is what makes horizontal scaling (K8s replicas, ECS desired-count, HPA) work without sticky sessions — JWTs carry the session, so any replica can serve any request.

## Three deployment topologies

The same two container images run in all three. What changes is what sits in front of them.

### 1. Docker Compose (local dev + production-style)

```
                    Browser
                       │
                       ▼
         ┌──────────── nginx (frontend container) ────────────┐
         │  /            → static SPA files (served directly) │
         │  /api/*       → proxy → backend:3001               │
         │  /health      → proxy → backend:3001               │
         │  /nginx-health→ answered by nginx itself           │
         └───────────────────────┬───────────────────────────┘
                                 │  internal Docker network
                                 ▼
                          backend:3001
                                 │
                                 ▼
                          postgres:5432
```

In `docker-compose.prod.yml`, **nginx is the only container that publishes a host port.** The backend is reachable only as `backend:3001` from inside the Compose network — not from the host, not from the internet. That single fact is what makes `TRUST_PROXY=1` safe (see Networking below).

`docker-compose.yml` (dev/CI) additionally runs Postgres in a container plus the Prometheus/Grafana/cAdvisor monitoring trio, all loopback-bound. `docker-compose.prod.yml` runs neither — a real deployment points `DATABASE_URL` at a managed database.

### 2. Kubernetes (local Minikube)

```
                    Browser
                       │
                       ▼
              Ingress (nginx controller)  host: foodbridge.local
                       │
                       ▼
              Service/frontend  (ClusterIP :8080)
                       │
                       ▼
              Deployment/frontend  (2 replicas, nginx)
                       │  proxies /api and /health, unchanged
                       ▼
              Service/backend  (ClusterIP :3001)
                       │
                       ▼
              Deployment/backend  (2 replicas, HPA → 5)
                       │
                       ▼
              Service/postgres (ClusterIP :5432) → Deployment/postgres + PVC
```

The backend Service is deliberately named `backend` on port 3001 so that `nginx.conf` — baked into the frontend image — works **unchanged**. No image rebuild, no config patching between Compose and Kubernetes.

The Ingress routes everything to the frontend and does *not* declare its own `/api` rule, because nginx already proxies `/api`. Adding one would be a second redundant proxy hop doing the same job.

### 3. AWS (Terraform target — designed, validated, never applied)

```
                         Internet
                            │
                            ▼
                    Route 53 (optional) ─ ACM cert (optional)
                            │
                            ▼
              ┌──── Application Load Balancer ────┐   public subnets (2 AZ)
              │  /api/*, /health → backend TG     │
              │  everything else → frontend TG    │
              └─────────────┬────────────────────┘
                            │
      ┌─────────────────────┴─────────────────────┐
      ▼                                           ▼   private subnets (2 AZ)
  ECS Fargate: frontend tasks            ECS Fargate: backend tasks
                                                    │
                                                    ▼
                                            RDS PostgreSQL (private, encrypted)
```

Note the one intentional difference from the other two topologies: **the ALB routes `/api/*` straight to the backend target group**, bypassing nginx's own proxy. That's the AWS-native pattern — the load balancer does the routing a reverse proxy would otherwise do. It requires no `nginx.conf` change; nginx simply never sees those paths there.

Full detail, including why ECS Fargate over EKS/EC2, is in [TERRAFORM.md](TERRAFORM.md).

## Request flow, end to end

A user claiming a donation, in the Compose/K8s topology:

1. Browser requests `https://host/` → nginx serves `index.html` + the JS bundle.
2. React app boots, reads `VITE_API_URL` (baked in at **build** time — `/api` for same-origin deployments).
3. App calls `POST /api/auth/login` → nginx matches `location /api/` → proxies to `backend:3001`, preserving the full path and appending the real client IP to `X-Forwarded-For`.
4. Express: `helmet` → `cors` → `express.json()` → **metrics middleware** → `loginLimiter` (rate limit) → validation → `auth.controller` → `auth.service` → bcrypt compare → Prisma query → Postgres.
5. Backend returns a JWT. Frontend stores it and sends `Authorization: Bearer <token>` on subsequent calls.
6. `PATCH /api/donations/:id/claim` → `authMiddleware` verifies the JWT and role → service layer runs the state transition inside a transaction → Postgres.
7. Response returns up the same path. On `res.finish`, the metrics middleware records duration and status against the **route pattern** `/api/donations/:id`.

## Deployment flow (CI/CD)

```
Developer → push / PR → GitHub
                          │
                          ▼
                    GitHub Actions
    ┌─────────────┬────────────┴──────────┬────────────────┐
    ▼             ▼                       ▼                ▼
 ci.yml       ci.yml                docker-publish    k8s-validate
 frontend     backend               build both        kubeconform +
 lint, tsc,   prisma migrate,       images, scan,     server dry-run
 test, build  test, build           push to GHCR      on ephemeral kind
              (real Postgres)       (not on PRs)
    │
    ▼
 ci.yml integration: compose up → curl /health → Trivy scan both images
```

Full detail in [CI_CD.md](CI_CD.md).

## Networking

Detailed in [NETWORKING.md](NETWORKING.md). The load-bearing points:

- **One public entry point** in every topology — nginx (Compose), Ingress (K8s), ALB (AWS). The backend is never directly internet-reachable in any of them.
- **`TRUST_PROXY` must equal the real number of proxy hops** — 1 for Compose and K8s, 2 for the ECS/ALB topology. It's what makes `req.ip` (and therefore rate-limiting) reflect the real client rather than the proxy. Set too high, a client could spoof `X-Forwarded-For` and evade rate limits; too low, all clients collapse into one rate-limit bucket.
- **Service discovery is DNS**: `backend:3001` resolves via Docker's embedded DNS (Compose) or CoreDNS (K8s). Same hostname, same port, both places — by design.

## Security

Detailed in [SECURITY.md](SECURITY.md). Summary of what's structural in the architecture itself:

- Containers run as **non-root** with **all Linux capabilities dropped**, `no-new-privileges`, and **read-only root filesystems** (tmpfs only where the process genuinely writes). nginx listens on 8080, not 80, specifically so it needs no `NET_BIND_SERVICE` capability.
- Secrets never live in images or manifests — env-injected from `.env.production` (Compose), K8s Secrets (`secret.example.yaml` holds only placeholders), or AWS Secrets Manager (Terraform generates them; they never touch a `.tfvars` file).
- The backend **refuses to start** on a weak, missing, or known-placeholder `JWT_SECRET`.
- Defense in depth on reachability: security groups (AWS) and network topology (Compose/K8s) both ensure the database accepts connections only from the application tier.

## Scalability

| Tier | How it scales | Limit |
|---|---|---|
| Frontend | Fixed replicas (2). Static files + thin proxy — never near its limits | Scale manually if needed |
| Backend | **HPA** (K8s, 2→5 @ 70% CPU) / **Application Auto Scaling** (ECS, same target) | Stateless, so scales freely |
| Database | Vertical (instance class), plus RDS Multi-AZ for failover and read replicas for read load | The real ceiling — the only stateful tier |

Only the backend autoscales, in both K8s and AWS, because it's the tier doing CPU-bound work (bcrypt, JSON, queries). The database is the genuine scaling ceiling, which is why the AWS design uses managed RDS with configurable Multi-AZ rather than a self-managed container.

Rolling updates are configured with `maxUnavailable: 0` (K8s) / `deployment_minimum_healthy_percent: 100` (ECS), so a deploy never reduces capacity below the current replica count — new pods/tasks must pass readiness probes before old ones are removed.
