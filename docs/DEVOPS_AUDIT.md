# DevOps Audit — FoodBridge

Date: 2026-09-17
Scope: full-repository audit performed before any DevOps changes were made. Nothing in the application or existing DevOps configuration was modified to produce this document.

## 1. What this project actually is

FoodBridge is a food-donation/rescue coordination platform:

- **Frontend**: React 18 + TypeScript, built with Vite, styled with Tailwind CSS + shadcn/ui (Radix primitives), React Router, TanStack Query, React Hook Form + Zod. Single-page app, statically built, served as static files.
- **Backend**: Node.js 20 + TypeScript, Express 4, Prisma ORM 5 against PostgreSQL. REST API under `/api/*`. JWT-based auth (`jsonwebtoken` + `bcryptjs`), `helmet`, `cors`, `express-rate-limit`, `express-validator`/`zod` for input validation.
- **Database**: PostgreSQL (managed via Prisma migrations, `backend/prisma/schema.prisma`, `backend/prisma/migrations/`). Models: `User`, `Donation`, `PickupRequest`, `Delivery`, `AdminLog`, `Notification`, `PasswordResetToken`.
- **Auth**: JWT bearer tokens issued by the backend; role-based access control (`DONOR`, `NGO`, `VOLUNTEER`, `ADMIN`) enforced in `backend/src/middleware/auth.ts` and per-route checks. Admin accounts can only be created via `backend/scripts/create-admin.ts` or the seed script — never through a public endpoint.
- **Email**: transactional email (password reset) via `nodemailer`/SMTP, explicitly gated by `NODE_ENV` so reset links/tokens are never logged in production.

This is **not a toy app**. The codebase contains extensive prior hardening work (visible as numbered "Phase N" comments — e.g. Phase 19 secrets/env handling, Phase 20 health checks, Phase 21 monitoring, Phase 22 password policy, Phase 24 auth hardening, Phase 25 email, Phase 26 backups, Phase 27 reverse-proxy networking, Phase 28 container hardening). It currently deploys to **Render** (referenced in `.env.example` comments) using its existing Docker images directly.

## 2. Existing DevOps capabilities (already present — do not rebuild these)

This is the most important finding of the audit: **significant, high-quality DevOps work already exists.** The task is to extend it (Kubernetes, Terraform, Ansible, docs, app-level metrics), not to bootstrap it from zero.

| Area | Status | Evidence |
|---|---|---|
| Dockerfile (frontend) | ✅ Multi-stage, `node:20-alpine` build → `nginx:alpine` runtime, runs as non-root `nginx` user, listens on unprivileged port 8080 | `Dockerfile` |
| Dockerfile (backend) | ✅ Multi-stage, `node:20-alpine`, `NODE_ENV=production` baked in, runs as non-root `node` user, only ships production deps + generated Prisma client | `backend/Dockerfile` |
| `.dockerignore` | ✅ Present at root and in `backend/` | `.dockerignore`, `backend/.dockerignore` |
| Docker Compose (dev/CI) | ✅ `docker-compose.yml` — Postgres, backend, frontend, Prometheus, Grafana, cAdvisor, all loopback-bound, healthchecks, no hardcoded Grafana password | `docker-compose.yml` |
| Docker Compose (prod) | ✅ `docker-compose.prod.yml` — no bundled DB (points at external Postgres), secrets from env only, `read_only` root FS, `cap_drop: ALL`, `no-new-privileges`, resource limits derived from real `docker stats` runs, single public entrypoint (nginx) | `docker-compose.prod.yml` |
| Reverse proxy | ✅ nginx reverse-proxies `/api` + `/health` to backend over the internal Docker network, backend has no published host port in prod, CSP/security headers configured, HTTPS instructions documented (not enabled by default, correctly) | `nginx.conf` |
| CI (build/test/lint) | ✅ GitHub Actions (`.github/workflows/ci.yml`): frontend job (lint, typecheck, test, build) and backend job (Prisma generate/migrate, test, build) against a real Postgres service container | `.github/workflows/ci.yml` |
| CI (integration + security scan) | ✅ Third `integration` job boots the real compose stack, curls health endpoints, runs Trivy against both built images (CRITICAL/HIGH) | `.github/workflows/ci.yml` |
| Container vulnerability scanning | ✅ Trivy, both in CI and via `make scan` locally | `.github/workflows/ci.yml`, `Makefile` |
| Health checks | ✅ `/health` checks real DB connectivity (not just process liveness); `/nginx-health` separately proves nginx itself is up; Docker healthchecks wired on both prod containers | `backend/src/app.ts`, `nginx.conf`, `docker-compose.prod.yml` |
| Secrets handling | ✅ No secrets committed; `.env.example` files with placeholders only; JWT_SECRET validated against known placeholder values and minimum length at startup; Grafana requires an explicit password with no default | `backend/src/config/index.ts`, `docker-compose.yml` |
| Container hardening | ✅ Non-root users, dropped capabilities, `read_only` filesystems with scoped tmpfs, `no-new-privileges`, memory/CPU limits — all empirically verified, documented inline | `Dockerfile` ×2, `docker-compose.prod.yml` |
| Backup/DR | ✅ `backend/scripts/backup/` (create/verify/restore), `backend/src/backup/lib.ts`, `.gitignore`'d backup directories | `backend/scripts/backup/`, `README.md` "Backup & Disaster Recovery" |
| Container-level monitoring | ✅ Prometheus + cAdvisor + Grafana wired in `docker-compose.yml` (dev/CI only, intentionally not in prod compose) | `docker-compose.yml`, `prometheus.yml` |
| Admin provisioning | ✅ Dedicated script, no public endpoint can create admins | `backend/scripts/create-admin.ts` |
| Local orchestration | ✅ `Makefile` with `up/down/build/logs/clean/prune/scan` | `Makefile` |
| Automated tests | ✅ 40+ backend Vitest files (security-focused: auth hardening, rate limiting, trust-proxy, password policy, admin provisioning, graceful shutdown...) + frontend Vitest/RTL tests | `backend/src/test/`, `src/test/` |
| Documentation | ✅ Extensive `README.md` covering architecture, security, deployment, health checks, backups — but no dedicated `docs/` directory | `README.md` |

## 3. Missing DevOps components (the actual gap — and the Deloitte-relevant skill set)

| Area | Status | Notes |
|---|---|---|
| **Kubernetes** | ❌ Missing entirely | No `k8s/` directory. Needed for the target role's K8s emphasis. App architecture (stateless frontend + stateless backend + external Postgres) maps cleanly onto Deployments/Services/ConfigMaps/Secrets/HPA. |
| **Terraform / IaC** | ❌ Missing entirely | No `terraform/` directory. Needed to demonstrate AWS target-architecture design (VPC, subnets, ALB, ECS/EKS or EC2, RDS, IAM) without requiring a real AWS account. |
| **Ansible** | ❌ Missing entirely | No `ansible/` directory. Realistic use here: configuring a Linux host (Docker install, firewall, unattended upgrades, monitoring agent) — i.e. VM bootstrapping, not application deployment (which Docker/K8s already own). |
| **Application-level metrics** | ⚠️ Partial | Prometheus currently scrapes only `cadvisor` (container-level CPU/mem) — there is no `/metrics` endpoint on the backend exposing request counts, latency, or error rates. This is a real, addressable gap (`prom-client` is trivial to add to Express). |
| **Docker image publishing workflow** | ⚠️ Partial | CI builds and scans images but never pushes to a registry (no GHCR workflow). Reasonable to add as an optional, credential-gated step. |
| **Kubernetes-targeted CD workflow** | ❌ Missing | No workflow scaffold for deploying manifests to a cluster (even a structured "prepared but not executed" one). |
| **Dedicated `docs/` directory** | ❌ Missing | All documentation currently lives in one large `README.md`. |
| **Backend lint** | ⚠️ Minor gap | Root has ESLint (`eslint.config.js`); `backend/` has no ESLint config, so backend CI has no lint step, only `tsc --noEmit` implicitly via `npm run build`. Worth a light-touch fix but out of scope for "DevOps" per se — noted, not silently ignored. |
| **Structured/centralized logging** | ⚠️ Minor gap | Backend logs via `console.error`/`console.log` only (no log levels, no JSON structured output, no correlation IDs). Fine for the current scale and out of scope to rebuild wholesale, but worth documenting as a stated limitation in `docs/MONITORING.md`/`docs/NETWORKING.md` rather than pretending it's solved. |

## 4. Potential problems / risks identified

1. **No AWS account** (explicitly stated by the project owner) — Terraform will be written and validated (`fmt`, `validate`) but never applied, and no real AWS deployment will be claimed anywhere in generated docs.
2. **Local monitoring stack currently measures containers, not the application** — Grafana dashboards built against only cAdvisor data cannot show request-level SLOs (latency, error rate). Adding `prom-client` to the backend is low-risk (additive, one new route + middleware) and closes this gap honestly rather than faking a dashboard.
3. **Kubernetes Secrets for local Minikube testing** must never contain the same values as any real `.env` — will use placeholder/example secrets only, following the existing repo convention (`*.example.yaml` mirrors `.env.example`).
4. **Backend has no ESLint config** — CI "lint" coverage is frontend-only. Flagged, not silently fixed as a side effect, since the task says not to modify application functionality beyond what DevOps integration requires; adding a minimal backend ESLint config is defensible as CI/DevOps scope and will be called out explicitly if done.
5. **Existing `docker-compose.yml` monitoring stack (Prometheus/Grafana/cAdvisor) is dev/CI-only by deliberate prior design** (documented inline) — Kubernetes monitoring (Phase 8 of this effort) should follow the same principle: real, working, but clearly local-cluster-only, not a claim of production observability.

## 5. Proposed DevOps architecture (target state)

```
Developer
   │
   ▼
GitHub  ──────────────────────────────────────────────┐
   │                                                    │
   ▼                                                    │
GitHub Actions (existing: lint/test/build/Trivy;        │
new: Docker image workflow, K8s manifest validation)     │
   │                                                    │
   ▼                                                    │
Container Images (existing Dockerfiles, unchanged)       │
   │                                                    │
   ▼                                                    │
Kubernetes (Minikube, local) ── new: k8s/ manifests       │
   ├── frontend Deployment/Service                       │
   ├── backend Deployment/Service                        │
   ├── ConfigMap / Secret (example)                       │
   ├── Ingress                                            │
   └── HPA                                                │
   │                                                    │
   ▼                                                    │
Prometheus (existing, extended with backend /metrics) ────┘
   │
   ▼
Grafana (existing)

Terraform (new, terraform/) ── describes the AWS target architecture
   (VPC → public/private subnets → ALB → ECS/EC2 → RDS) — validated
   locally (fmt/validate) only, never applied, no AWS credentials used.

Ansible (new, ansible/) ── configures a Linux host: Docker install,
   firewall rules, unattended-upgrades, node_exporter — idempotent,
   run locally against localhost/a throwaway VM for validation.
```

## 6. Implementation plan (phases 3–14 of the original brief)

Existing capabilities from §2 are **preserved as-is** unless a specific bug is found; work below targets §3's gaps only.

1. **Docker** — already production-quality. Action: verify `docker compose up --build` still works end-to-end today (regression check only, no rewrite).
2. **CI/CD** — extend `.github/workflows/` with (a) a Docker build+scan workflow separated from the monolithic CI file is optional since Trivy already runs in `integration`; more valuable: (b) a `docker-publish.yml` gated on a repo secret (push to GHCR only if credentials exist), (c) a `k8s-deploy.yml` that validates manifests (`kubectl apply --dry-run=client`, `kubeval`/`kubeconform`) but explicitly does not deploy anywhere, since there is no cluster to deploy to in CI.
3. **Terraform** — new `terraform/` project: VPC, public/private subnets, security groups, IAM roles, ALB, ECS Fargate (or EC2 ASG — will default to ECS Fargate as the more modern/managed pattern, document the alternative), RDS Postgres. `terraform fmt` + `terraform validate` run locally; no `apply`.
4. **Kubernetes** — new `k8s/` manifests for Minikube: Namespace, backend/frontend Deployments+Services, ConfigMap, `secret.example.yaml`, Ingress, HPA, readiness/liveness probes reusing the existing `/health` and `/nginx-health` endpoints. Actually deployed to a local Minikube cluster and verified with `kubectl get pods/services`, `kubectl logs`, `kubectl rollout status`.
5. **Ansible** — new `ansible/` project: a realistic "prepare a fresh Linux host to run this stack" playbook — install Docker Engine + Compose plugin, create an app user, configure UFW, install `node_exporter`. Idempotency verified by running the playbook twice locally (via `ansible-playbook --check` and a real localhost run) and confirming zero changes on the second run.
6. **Monitoring** — add a `/metrics` endpoint to the backend (`prom-client`, default Node metrics + HTTP request duration/count histogram), add it as a Prometheus scrape target, add it to the Kubernetes stack too (via a K8s-native Prometheus deployment or the existing Compose stack, whichever fits without overengineering — leaning towards keeping Prometheus/Grafana in Compose for local dev as today, and documenting how the same `/metrics` endpoint would be scraped in K8s via a `ServiceMonitor`/annotations without standing up a second full Prometheus for this exercise).
7. **Logging** — document current state honestly (console-based, relies on the container runtime/orchestrator to capture stdout/stderr) in `docs/`. No large logging-framework migration — out of proportion to the ask and risks breaking working code for cosmetic gain.
8. **Networking docs** — `docs/NETWORKING.md` covering the real request path (browser → nginx → backend, and the K8s Ingress → Service → Pod equivalent) using the actual ports/paths already in `nginx.conf`/K8s manifests.
9. **Security** — `docs/SECURITY.md` summarizing what's already implemented (§2) plus what CI enforces (Trivy) plus any new checks added for Terraform/K8s/Ansible (e.g. `tfsec`/`checkov` if available, `kubeconform`, `ansible-lint`) — added only if they run cleanly locally, not claimed if untested.
10. **Testing/validation** — every phase gets actually executed locally (Docker build, Compose up, Minikube deploy, Terraform fmt/validate, Ansible syntax-check + idempotency run) with real command output, not just files written.
11. **Documentation** — full `docs/` tree plus updated root `README.md` plus `docs/DEVOPS_IMPLEMENTATION_REPORT.md` and `docs/INTERVIEW_GUIDE.md`, all with an explicit, unambiguous "AWS was not deployed to" statement.

## 7. What will NOT be done

- No `terraform apply`, no AWS credentials requested or used, no claim of AWS deployment anywhere.
- No rewrite of the existing Dockerfiles/Compose files/nginx config — they already meet or exceed what this exercise would produce from scratch; only additive changes (e.g. a `/metrics` route) touch application code, and only where strictly needed for a DevOps capability (monitoring).
- No replacement of the existing CI file's working jobs — only additive workflows.
- No fake tooling added purely to pad a resume keyword list (e.g. no service mesh, no Helm chart unless it demonstrably simplifies the K8s manifests, no multi-region anything).
