# DevOps Implementation Report

Date: 2026-09-17

## AWS limitation — stated up front

> **AWS deployment was not performed because no active AWS account/credentials were available. Terraform configurations were prepared for AWS deployment and validated locally where possible.**

Specifically: `terraform fmt`, `terraform init -backend=false`, and `terraform validate` all pass. `terraform plan` was run once to confirm it fails cleanly at the STS credential check before creating anything. **`terraform apply` has never been run.** No AWS resource has ever existed. No AWS experience, deployment, or testing should be inferred from this work — the Terraform is a design artefact that is syntactically and structurally validated, nothing more.

Everything else in this report was genuinely executed and verified locally.

## Project before DevOps

FoodBridge was already a well-engineered application with substantial existing DevOps work — this is the most important context for reading the rest of this report. It was **not** a bare application.

**Application:** React 18 + TypeScript SPA (Vite, Tailwind, shadcn/ui) and a Node.js 20 + Express + TypeScript REST API with Prisma ORM against PostgreSQL. JWT auth with four roles. Deployed to Render.

**Already present and good** (visible as numbered "Phase 19–28" comments recording prior hardening):

- Multi-stage Dockerfiles for both services, running non-root, with `.dockerignore` files
- `docker-compose.yml` (dev/CI, with a Prometheus/Grafana/cAdvisor stack) and `docker-compose.prod.yml` (hardened: `cap_drop: ALL`, `read_only`, `no-new-privileges`, resource limits from real `docker stats` observation, secrets from env only, no bundled database)
- nginx reverse proxy with CSP and security headers; backend deliberately unpublished in production
- GitHub Actions CI: frontend (lint, typecheck, test, build), backend (Prisma migrate + test + build against a real Postgres service container), and an integration job that boots the compose stack, curls health endpoints, and runs Trivy against both images
- DB-aware `/health` endpoint, Docker healthchecks, graceful SIGTERM shutdown
- Backup/restore scripts, secure admin provisioning, strong secret validation at startup
- 640 tests, many security-focused

**Genuinely missing:** Kubernetes, Terraform/IaC, Ansible, application-level metrics, a `docs/` tree, image publishing, and manifest validation in CI.

So this work was **additive extension of a strong baseline, not a rebuild.** Existing configuration was preserved wherever it already met or exceeded what would have been written from scratch — per the brief's own instruction to keep better existing approaches.

## DevOps improvements

### Docker

**No changes to containerization** — the existing Dockerfiles and compose files were audited and found to be production-quality already: multi-stage builds, non-root users, minimal runtime images (`npm ci --omit=dev` plus compiled output only), correct dependency-layer caching, healthchecks, and hardening that had been empirically verified rather than guessed.

Rebuilding them would have produced something equivalent at best. So the Docker work here was **verification plus one real bug fix**:

- Confirmed `docker compose up --build` works end-to-end: DB healthy, backend `/health` returning `database: ok`, frontend serving 200.
- Confirmed `docker-compose.prod.yml` hardening is genuinely applied at runtime, by inspecting live containers — `CapDrop=[ALL]`, `ReadonlyRootfs=true`, `no-new-privileges`, memory limits, non-root uids (1000/101), both `healthy`.
- Confirmed the backend is genuinely unreachable from the host in the production topology while the same request through nginx succeeds.
- **Fixed a production-blocking bug** (below).
- Added Grafana provisioning mounts so the monitoring stack is useful on first start.

### Bug found and fixed: production stack could not start

Found by actually running the production compose file rather than reading it.

**Symptom:** `foodbridge-backend-prod` never became healthy; because `frontend` gates on `depends_on: condition: service_healthy`, **the frontend container could never start at all.**

**Root cause:** the healthcheck used `http://localhost:3001/health`. `node:alpine`'s `/etc/hosts` maps `localhost` to both `127.0.0.1` and `::1`; busybox wget tries IPv6 first; but `backend/src/index.ts` binds `0.0.0.0` — IPv4 only. Every probe hit a closed IPv6 socket:

```
Connecting to localhost:3001 ([::1]:3001)
wget: can't connect to remote host: Connection refused
```

Confirmed by `wget http://127.0.0.1:3001/health` succeeding in the same container where `localhost` failed.

**Fix:** pin the probe to the IPv4 loopback. The frontend healthcheck was checked and is not affected — `nginx.conf` explicitly declares `listen [::]:8080`.

**Verified:** stack now reports `Healthy`, frontend starts, end-to-end requests return 200 with `database: ok`. A regression test in `src/test/container-hardening.test.ts` asserts `127.0.0.1` and not `localhost`, with the reasoning inline.

### Kubernetes

New `k8s/` directory, **actually deployed to and debugged on a real Minikube cluster** — not written and left unvalidated.

Namespace, ConfigMap, `secret.example.yaml` (placeholders only), local-testing Postgres (Deployment + PVC + Service), backend and frontend Deployments + Services, Ingress, and an HPA.

Design decisions that mattered:

- **The backend Service is named `backend` on port 3001 deliberately**, because `nginx.conf` — baked into the frontend image — already proxies to `http://backend:3001`. This makes the *same image* work in Compose and Kubernetes with no rebuild and no config patching.
- **The Ingress has no `/api` rule** — nginx already proxies it; adding one would be a redundant second proxy hop.
- **Probes reuse the existing split endpoints**: backend on `/health` (real DB connectivity), frontend on `/nginx-health` (nginx only). Using `/health` for the frontend would make it report unhealthy for a database fault that isn't nginx's problem.
- **Pod `securityContext` mirrors the Docker hardening exactly**; resource requests/limits come from the same real `docker stats` numbers already documented in the prod compose file.
- **Only the backend autoscales** (2→5 @ 70% CPU) — the frontend serves static files and never approaches its limits.
- **Postgres is a Deployment, not a StatefulSet**, and the manifest says plainly that this is disposable local-testing scaffolding, not a production database pattern.

**Real problem hit and fixed:** backend pods went `Init:CrashLoopBackOff` for the first ~50s of a fresh deploy. `kubectl logs deploy/backend -c migrate` showed `P1001: Can't reach database server at postgres:5432`. Kubernetes has no equivalent of Compose's `depends_on: condition: service_healthy`, so the `migrate` initContainer ran before Postgres finished first-boot initialization. It self-healed via crash-loop backoff, which is luck, not design. Fixed with a `wait-for-postgres` initContainer that polls the port. Verified from scratch (deleted Deployments and PVC, redeployed): clean rollout, **0 restarts**.

Verified end state: all 5 pods `Running`, `/health` returning `database: ok` through the frontend's proxy, HPA reporting `cpu: 1%/70%` with `ScalingActive: True`.

### Terraform

New `terraform/` project targeting **AWS ECS Fargate**, structured as a root module plus four child modules (`networking`, `security`, `database`, `compute`).

Designed: VPC across 2 AZs with public/private subnets, IGW, NAT Gateway per AZ, route tables; three chained security groups; RDS PostgreSQL 15 (encrypted, private, 7-day backups); ECR with immutable tags, scan-on-push and a keep-last-10 lifecycle policy; ALB with path-based routing and optional ACM/HTTPS; ECS Fargate services for both tiers; Application Auto Scaling; two IAM roles; Secrets Manager; CloudWatch Logs.

Decisions worth noting:

- **ECS Fargate over EKS or EC2** — no AMIs, patching, or SSH (vs EC2); no control-plane cost or operational overhead for a two-service app (vs EKS, with the Kubernetes work demonstrated properly on Minikube instead).
- **Secrets generated in-config** via `random_password` and stored in Secrets Manager — they never pass through a `.tfvars` file, shell history, or CI log.
- **IAM least privilege taken seriously**: the Secrets Manager grant names two exact ARNs, never `*`; the task role has **no policies at all**, because the application makes no AWS API calls.
- **`TRUST_PROXY = 2`** here (vs 1 for Compose/K8s) — ALB plus `awsvpc` is two hops, and the value must match the real count exactly.
- **The ALB routes `/api/*` directly to the backend**, the AWS-native pattern, requiring no `nginx.conf` change.

Honest limitations documented in the config itself and in [TERRAFORM.md](TERRAFORM.md): `deletion_protection = false` / `skip_final_snapshot = true` must be flipped before a real apply; `:latest` image tags are placeholders; no remote state backend; NAT Gateways are the dominant recurring cost, with the single-NAT trade-off spelled out.

### Ansible

New `ansible/` project: five roles (`app_user`, `docker`, `firewall`, `node_exporter`, `unattended_upgrades`) that prepare a fresh Linux host to run the production compose stack.

Scope boundary is deliberate: Ansible configures **the machine**, not the application. Docker and CI already own deployment. Folding `docker compose up` into a playbook would duplicate CI and blur two responsibilities.

**Actually executed against a real systemd-capable Ubuntu 22.04 container, twice, to prove idempotency:**

```
First run:   ok=32  changed=23  failed=0
Second run:  ok=29  changed=0   failed=0    ← idempotent
```

Then verified by effect, not by Ansible's own success report: `docker --version` and `docker compose version` both working, `id foodbridge` showing the user in the `docker` group, `ufw status verbose` showing default-deny with exactly 22/80/443 open, `node_exporter` active and serving real metrics on 9100, `unattended-upgrades` active.

Problems hit and fixed along the way: `group_vars/` must live next to the inventory file (caused `'app_user' is undefined`); `community.general.yaml` callback was removed in v12 (replaced with `result_format = yaml`); legacy `ansible_distribution` fact variables are deprecated (moved to `ansible_facts[...]`).

### CI/CD

`ci.yml` was already good and was **left alone**. Two workflows added:

**`docker-publish.yml`** — builds both images on a matrix, pushes to GitHub Container Registry using the built-in `GITHUB_TOKEN` with `packages: write` (no manual secret setup, no long-lived credential anywhere). Tags: `latest` on the default branch, branch name, semver on `v*`, and always `sha-<commit>` — the immutable tag a real deployment should pin. Builds on PRs but never pushes, because fork PRs don't get write-scoped tokens and pushing unreviewed code would be an unwanted side effect. Layer caching scoped per image.

**`k8s-validate.yml`** — `kubeconform` against the real Kubernetes schema, plus `kubectl apply --dry-run=server` against an ephemeral `kind` cluster created and destroyed inside the job.

That second check exists in that form because of something verified rather than assumed: **`kubectl --dry-run=client` is not actually cluster-less.** It still contacts the API server to resolve schemas, and fails with `failed to download openapi: Authentication required` without one. So a throwaway cluster is the honest way to get server-side validation in CI — and it's strictly more thorough, since it exercises real admission control.

No workflow pretends to deploy. There is no cluster and no cloud account, and a `deploy.yml` that existed only to have the filename would be the resume-padding this work avoids.

### Monitoring

This was the one genuine capability gap, and closing it required **real application code**, not configuration.

Before: Prometheus scraped only cAdvisor. The stack could report that a container used 40% CPU but had **no way to know the request rate, latency, or error rate** — cAdvisor structurally cannot see inside a process.

Added `backend/src/metrics.ts` (`prom-client`) exposing `GET /metrics`:

- `http_requests_total{method, route, status_code}` counter
- `http_request_duration_seconds` histogram with buckets tuned to this API's real profile (resolution in both the 5–100ms normal range and the 100–500ms bcrypt-bearing auth range)
- prom-client default Node metrics: event-loop lag, heap, GC, file descriptors

**Label cardinality was the main engineering concern.** The `route` label is the Express route *pattern* (`/api/donations/:id`), never the concrete URL — otherwise N donations produce N time series and Prometheus eventually dies. Unmatched paths collapse to `route="unmatched"` rather than echoing the requested path, so nobody can create unlimited series by requesting random URLs. Both are covered by tests, along with an assertion that no connection string, JWT secret, or password material appears in the output.

`/metrics` is unauthenticated but structurally non-public: nginx proxies only `/api` and `/health`, the K8s Service is `ClusterIP`, and the ALB has no matching listener rule.

Also added: Prometheus scrape config for the backend; Grafana provisioning (datasource + an 11-panel dashboard in git, so recreating the volume loses nothing); and `node_exporter` via Ansible, completing three layers — application, container, host.

**Verified with real data:** all three Prometheus targets `up`; `http_requests_total` showing correct pattern labels and the `unmatched` guard working; p95 latency of 43.75ms (`/health`) and 45.99ms (`/api/donations`) after sustained traffic; and p95 queried successfully *through Grafana's own datasource proxy*, not just from Prometheus directly.

**Honest limitation:** the two cAdvisor panels are empty on Docker Desktop for Mac. cAdvisor needs the container runtime's socket to resolve names, and Docker Desktop doesn't expose containerd's socket to the host — confirmed from the container's own logs. Mounting `/var/run/docker.sock` was tested, moved the error one step, and did not fix it, so it was **not** added to the compose file: config that looks like a fix while changing nothing is worse than a documented limitation. The panels keep name-based queries because those are correct on Linux (where this stack would run), and the macOS-compatible cgroup-id query is documented.

### Logging

Reviewed and **deliberately not migrated**. Documented in [LOGGING.md](LOGGING.md).

The backend uses `console.log`/`console.error` with no levels, JSON, or correlation IDs — a real limitation, stated as such. But the part that's genuinely hard to retrofit is already correct: logs go to stdout/stderr only (twelve-factor, and compatible with the read-only filesystem), and sensitive data is properly excluded. Notably the health check logs `error.message` rather than the error object, because a Prisma connection error can embed the full `DATABASE_URL` including the password — subtle, easy to get wrong, already right here. Password-reset tokens are gated on `NODE_ENV` with a dedicated test.

A `pino` migration would have touched many application files for no operational gain at single-instance scale, against the constraint not to modify application functionality beyond what a DevOps capability requires. The doc records the trigger for revisiting (multiple instances plus an aggregator) and the priority order, noting that the metrics route-label helper is exactly what a structured access log should use.

### Networking

No changes — the existing topology was already correct. Documented in [NETWORKING.md](NETWORKING.md): ports, the full request path in all three topologies, DNS at three layers (public, Docker embedded, CoreDNS), TLS options, load balancing, and `TRUST_PROXY`.

The `TRUST_PROXY` section is worth singling out because it captures a real security coupling: nginx uses `$proxy_add_x_forwarded_for` (appending its own unforgeable socket-level view of the peer) and Express with `trust proxy = 1` reads only the rightmost entry — so a client-supplied `X-Forwarded-For` can only land earlier in the chain, where it's ignored. **That protection depends entirely on the backend being unreachable except through nginx**, which is why the prod compose file publishes no backend port. Those are one security decision, not two.

### Security / DevSecOps

A real audit was performed. Results in [SECURITY.md](SECURITY.md).

**Clean:** no real `.env` ever tracked or committed (checked across all 19 commits with `--diff-filter=A`); no AWS access keys or PEM private keys anywhere in history; gitignore correctly covers `.env`, `k8s/secret.yaml`, `*.tfstate`, `terraform.tfvars` while *not* swallowing the `.example` templates.

**Verified live:** container hardening confirmed on running containers rather than read from YAML.

**Dependency audit — `npm audit`:** 4 moderate (frontend), 2 moderate (backend), **zero critical or high**. The `vitest`/`@vitest/mocker` advisories are dev-only and never installed into the runtime image.

The `react-router` advisories are runtime and warranted real investigation. One (SSR hydration constructor injection) **does not apply** — this is a static SPA with no SSR. The other (open redirect via backslash in `<Link>`/`useNavigate`) is **present but not reachable**: I independently audited all 19 navigation call sites and every one passes a hardcoded literal or a closed-enum value (`user.role`, or `destinationFor()`'s switch over `NotificationType` returning literals/`null`). No query param, `location.state`, or URL fragment reaches a navigation target anywhere. The repo had already documented this analysis; my independent check confirmed it still holds. **Residual risk is stated plainly**: this is mitigated by application design, not by patching — the fix needs a breaking `react-router-dom@7` upgrade, and if a future feature ever navigates to user-supplied input, it becomes exploitable.

**Gaps flagged rather than hidden:** no backend ESLint config (so no backend lint in CI); Trivy non-blocking (`exit-code: '0'`) — a defensible trade-off with a stated cost; Kubernetes Secrets are base64, not encrypted; no NetworkPolicies (Minikube's default CNI wouldn't enforce them, so shipping them would imply a control that isn't active); no `tfsec`/`checkov`; no CI secret scanning; no SSH hardening in Ansible.

## Testing and validation

Everything below was actually run.

| Check | Command | Result |
|---|---|---|
| Frontend lint | `npm run lint` | Clean |
| Frontend typecheck | `npx tsc --noEmit` | Clean |
| Frontend tests | `npm test` | **157 passed**, 17 files |
| Frontend build | `npm run build` | Success |
| Backend tests | `npx vitest run` (real Postgres) | **483 passed**, 33 files |
| New metrics tests | included above | **6 passed** |
| Container hardening tests | `npx vitest run src/test/container-hardening.test.ts` | **30 passed** (incl. new regression guard) |
| Docker build | `docker compose up -d --build` | Both images build, stack healthy |
| Docker prod stack | `docker compose -f docker-compose.prod.yml up -d` | Healthy **after bug fix** |
| Kubernetes deploy | `kubectl apply -f k8s/` on Minikube | All pods Running, 0 restarts |
| K8s rollout | `kubectl rollout status` | Both Deployments rolled out |
| K8s health | `curl` via port-forward | 200 + `database: ok` |
| HPA | `kubectl get/describe hpa` | `cpu: 1%/70%`, `ScalingActive: True` |
| Terraform format | `terraform fmt -recursive` | Applied |
| Terraform init | `terraform init -backend=false` | Success |
| Terraform validate | `terraform validate` | **Success! The configuration is valid.** |
| Terraform plan | `terraform plan` | Fails cleanly at STS — **as expected, no account** |
| Ansible syntax | `ansible-playbook --syntax-check` | Pass |
| Ansible converge | real Ubuntu 22.04 container | `changed=23, failed=0` |
| Ansible idempotency | same playbook, second run | **`changed=0`** |
| Prometheus targets | `/api/v1/targets` | All 3 `up` |
| Grafana provisioning | datasource + dashboard API | Both auto-provisioned |
| Metrics through Grafana | datasource proxy query | p95 returned |
| Git history secrets scan | `git grep` across all commits | Clean |
| npm audit | both scopes | 0 critical, 0 high |

**Total: 640 application tests passing.** Original functionality verified intact — the full pre-existing suite passes unchanged, plus the new tests.

## Problems encountered and fixed

1. **Production compose stack couldn't start** — IPv6/IPv4 healthcheck mismatch. Fixed + regression test. *(Real bug, would have blocked any real deployment.)*
2. **K8s backend `Init:CrashLoopBackOff`** — no Compose-style `depends_on` in Kubernetes. Fixed with a `wait-for-postgres` initContainer; verified 0 restarts from a clean slate.
3. **`kubectl --dry-run=client` needs a live cluster** — discovered before committing a CI workflow that would always have failed. Redesigned around `kubeconform` + ephemeral `kind`.
4. **Ansible `group_vars` location** — must be adjacent to the inventory file.
5. **Removed Ansible callback plugin** — `community.general.yaml` gone in v12; switched to `result_format = yaml`.
6. **Ansible deprecation warnings** — migrated to `ansible_facts[...]`; re-verified idempotency after the change.
7. **Frontend image had the dev `VITE_API_URL` baked in** — rebuilt with `--build-arg VITE_API_URL=/api` for the cluster, since Vite bakes it in at build time.
8. **Grafana required password blocked partial compose starts** — Compose interpolates all services' env before filtering.
9. **Host port 8080 conflict** with an unrelated process — used a local override with Compose's `!override` tag (lists append by default), leaving the committed file untouched.
10. **cAdvisor container names unavailable on macOS** — investigated to root cause, tested a candidate fix, rejected it as ineffective, documented honestly.
11. **`histogram_quantile` returning `NaN`** — `rate()` needs ≥2 samples; generated sustained traffic to prove the histogram genuinely works.
12. **Frontend `node_modules` missing** — `npm ci --legacy-peer-deps`.

## Remaining limitations

1. **No AWS deployment.** Terraform validated, never applied. No AWS resource has ever existed.
2. **`react-router` open-redirect advisory** — mitigated by application design (verified), not patched. Needs a breaking major upgrade. *Highest-priority remaining security item.*
3. **No backend ESLint** — backend CI has no lint step.
4. **Trivy non-blocking** — results must be read by a human.
5. **cAdvisor panels empty on Docker Desktop for Mac** — platform limitation, documented with a working alternative query.
6. **No structured logging** — reviewed, deliberately deferred, with the revisit trigger documented.
7. **No alerting rules** — metrics exist, but alerts without a receiver and an on-call rotation would be configuration theatre. Example rules are provided, inactive.
8. **No Kubernetes NetworkPolicies** — Minikube's default CNI doesn't enforce them.
9. **K8s Postgres is not production-grade** — deliberately disposable local scaffolding.
10. **No TLS by default** — both enablement paths documented; the repo never manages certificates.
11. **Ansible is Debian/Ubuntu-only**, tested in a container rather than on a real cloud VM.
12. **`terraform fmt`/`validate` not in CI** — run locally; would be a cheap addition.

## How to run the complete project locally

```bash
# ---- Prerequisites: Docker, Node 20+. Optional: minikube, kubectl, terraform, ansible.

# ---- 1. Full stack with monitoring
echo 'GRAFANA_ADMIN_PASSWORD=pick-something-local' >> .env   # gitignored; required
docker compose up -d --build

#   Frontend    http://localhost:5174
#   Backend     http://localhost:4000/health   http://localhost:4000/metrics
#   Prometheus  http://localhost:9090
#   Grafana     http://localhost:3000   (admin / your password)
#               → Dashboards → FoodBridge → "FoodBridge — Service Overview"
#   cAdvisor    http://localhost:8080

# ---- 2. Run the test suites
npm ci --legacy-peer-deps
npm run lint && npx tsc --noEmit && npm test && npm run build      # 157 tests

docker exec foodbridge-db createdb -U postgres foodbridge_test
cd backend
DATABASE_URL="postgresql://postgres:password@localhost:5433/foodbridge_test?schema=public" \
  npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:password@localhost:5433/foodbridge_test?schema=public" \
  JWT_SECRET="local-test-secret-at-least-32-characters-long-xxxxx" \
  npx vitest run                                                    # 483 tests
cd ..

# ---- 3. Production-style stack
cp .env.production.example .env.production    # then fill in real values
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
#   Frontend on http://localhost  (backend intentionally NOT reachable from the host)

# ---- 4. Kubernetes
minikube start --driver=docker
minikube addons enable ingress metrics-server
docker build -t foodbridge-backend:local ./backend
docker build -t foodbridge-frontend:local --build-arg VITE_API_URL=/api .
minikube image load foodbridge-backend:local
minikube image load foodbridge-frontend:local

kubectl apply -f k8s/namespace.yaml -f k8s/configmap.yaml
cp k8s/secret.example.yaml k8s/secret.yaml && $EDITOR k8s/secret.yaml   # gitignored
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/postgres.yaml -f k8s/backend-deployment.yaml \
               -f k8s/frontend-deployment.yaml -f k8s/ingress.yaml -f k8s/hpa.yaml

kubectl -n foodbridge rollout status deploy/backend
kubectl -n foodbridge port-forward svc/frontend 18080:8080
#   → http://localhost:18080

# ---- 5. Terraform (validation only - never applies, needs no credentials)
cd terraform
terraform fmt -recursive && terraform init -backend=false && terraform validate
cd ..

# ---- 6. Ansible (against a throwaway container)
docker run -d --name ansible-test-host --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw geerlingguy/docker-ubuntu2204-ansible:latest
cd ansible
ansible-playbook -i inventory/test-docker.ini -c community.docker.docker playbooks/site.yml
ansible-playbook -i inventory/test-docker.ini -c community.docker.docker playbooks/site.yml
#   ^ second run must report changed=0
cd ..

# ---- Teardown
docker compose down -v
docker rm -f ansible-test-host
kubectl delete namespace foodbridge && minikube stop
```

## Technologies implemented

**Containers:** Docker, multi-stage builds, Docker Compose, container hardening (non-root, `cap_drop`, read-only rootfs, `no-new-privileges`, resource limits), healthchecks
**Orchestration:** Kubernetes — Deployments, Services, ConfigMaps, Secrets, PVC, Ingress, HPA, readiness/liveness probes, initContainers, rolling updates, `securityContext`; Minikube
**IaC:** Terraform — modules, variables, outputs, AWS provider (VPC, subnets, IGW, NAT, route tables, security groups, IAM, ALB, ECS Fargate, ECR, RDS, Secrets Manager, CloudWatch Logs, Application Auto Scaling)
**Config management:** Ansible — roles, handlers, templates, inventory, group_vars, idempotency
**CI/CD:** GitHub Actions — matrix builds, service containers, Buildx, GHCR, layer caching, scoped `permissions`, kubeconform, ephemeral `kind`
**Monitoring:** Prometheus, Grafana (provisioned datasource + dashboard), cAdvisor, node_exporter, `prom-client`, PromQL
**Security:** Trivy, `npm audit`, git-history secret scanning, CSP/security headers, IAM least privilege, secrets management
**Networking:** nginx reverse proxy, TCP/IP (incl. a real IPv4/IPv6 bug), DNS (public/Docker/CoreDNS), load balancing, TLS design, UFW, security groups
**Linux:** systemd units, UFW, unattended-upgrades, users/groups/permissions, apt

## Files created and modified

### Created

```
docs/  DEVOPS_AUDIT.md  ARCHITECTURE.md  CI_CD.md  TERRAFORM.md  KUBERNETES.md
       ANSIBLE.md  MONITORING.md  NETWORKING.md  SECURITY.md  LOGGING.md
       TROUBLESHOOTING.md  DEVOPS_IMPLEMENTATION_REPORT.md

k8s/   namespace.yaml  configmap.yaml  secret.example.yaml  postgres.yaml
       backend-deployment.yaml  frontend-deployment.yaml  ingress.yaml  hpa.yaml

terraform/  versions.tf  providers.tf  main.tf  variables.tf  outputs.tf
            terraform.tfvars.example  .gitignore  README.md
            modules/networking/{main,variables,outputs}.tf
            modules/security/{main,variables,outputs}.tf
            modules/database/{main,variables,outputs}.tf
            modules/compute/{ecr,iam,secrets,alb,ecs,autoscaling,variables,outputs}.tf

ansible/  ansible.cfg  playbooks/site.yml
          inventory/{hosts.ini,test-docker.ini}  inventory/group_vars/all.yml
          roles/app_user/tasks/main.yml
          roles/docker/tasks/main.yml
          roles/firewall/tasks/main.yml
          roles/node_exporter/{tasks/main.yml,handlers/main.yml,templates/node_exporter.service.j2}
          roles/unattended_upgrades/{tasks/main.yml,templates/50unattended-upgrades.j2}

monitoring/grafana/provisioning/datasources/prometheus.yml
monitoring/grafana/provisioning/dashboards/dashboards.yml
monitoring/grafana/dashboards/foodbridge-overview.json

.github/workflows/docker-publish.yml
.github/workflows/k8s-validate.yml

backend/src/metrics.ts
backend/src/test/metrics.test.ts
```

### Modified

```
docker-compose.prod.yml            healthcheck IPv4 fix (real bug) + reasoning
docker-compose.yml                 Grafana provisioning mounts
prometheus.yml                     added the backend /metrics scrape job
backend/src/app.ts                 metrics middleware + /metrics endpoint (additive)
backend/package.json               + prom-client
backend/package-lock.json          lockfile
.gitignore                         k8s/secret.yaml, terraform state/tfvars
src/test/container-hardening.test.ts   + healthcheck regression test
README.md                          DevOps sections + docs index
```

Application functionality was not otherwise altered. The only application-code change is the additive metrics middleware and endpoint, required for the monitoring capability.
