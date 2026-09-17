# CI/CD

Three workflows in `.github/workflows/`. `ci.yml` already existed and is good — it was extended, not rewritten. The other two are new.

## `ci.yml` — test, lint, build, integration (pre-existing)

Triggers on push and PR to `main`/`master`. Three jobs, run in parallel where possible.

### Job: `frontend`
```
checkout → setup-node 20 (npm cache) → npm ci --legacy-peer-deps
        → npm run lint        (ESLint)
        → npx tsc --noEmit    (type check)
        → npm test            (Vitest + React Testing Library)
        → npm run build       (Vite production build)
```

`--legacy-peer-deps` is required by this dependency tree; `tsc --noEmit` is separate from the build because Vite's build does not type-check by itself.

### Job: `backend`
```
services: postgres:16-alpine (with pg_isready health-gate)

checkout → setup-node 20 → npm ci
        → npx prisma generate
        → npx prisma migrate deploy   (against the real service Postgres)
        → npm test                     (483 tests, 33 files)
        → npm run build                (tsc)
```

Tests run against a **real PostgreSQL service container**, not mocks. That's the right call for a Prisma app: mocked database tests pass while real migrations break. The `JWT_SECRET` here is a disposable CI-only value that satisfies the app's startup validation (≥32 chars, not a known placeholder).

### Job: `integration`
```
docker compose up -d --build db backend frontend
sleep 10
curl -f http://localhost:4000/health   → must return 200
curl -f http://localhost:5174/          → must return 200
Trivy scan: foodbridge-frontend  (CRITICAL,HIGH, ignore-unfixed)
Trivy scan: foodbridge-backend   (CRITICAL,HIGH, ignore-unfixed)
docker compose down
```

This is the job that catches what unit tests can't: that the images actually build, the containers actually start, the backend actually reaches Postgres, and nginx actually serves the SPA.

`GRAFANA_ADMIN_PASSWORD` is set at job level even though Grafana is never started — Compose interpolates *every* service's environment before filtering to the requested service names, and Grafana's password deliberately has no default. A disposable CI value, never a real credential.

Trivy runs with `exit-code: '0'`, so scan results are **reported but non-blocking**. That's a defensible trade-off for a project of this size (a new upstream CVE in a base image shouldn't block an unrelated PR), but it does mean someone has to read the output. Flipping it to `exit-code: '1'` is the stricter posture — see [SECURITY.md](SECURITY.md).

## `docker-publish.yml` — build and push images (new)

Triggers on push to `main`/`master`, on `v*` tags, on PRs (build only), and manually.

```
matrix: [frontend (context .), backend (context ./backend)]

checkout → setup-buildx
        → login to ghcr.io          (skipped on pull_request)
        → docker/metadata-action    (derive tags)
        → docker/build-push-action  (push: only when not a PR)
```

**Registry: GitHub Container Registry**, authenticated with the built-in `GITHUB_TOKEN` and `packages: write` permission. No manual secret setup is required and no long-lived credential exists anywhere — this is why GHCR was chosen over Docker Hub for a project with no cloud account.

**PRs build but never push.** Fork PRs don't receive write-scoped tokens, and pushing an image from unreviewed code would be an unwanted side effect. The build still runs, so a broken Dockerfile fails the PR.

**Tagging** via `docker/metadata-action`: `latest` (default branch only), the branch name, the semver version on `v*` tags, and always `sha-<commit>`. The `sha-` tag is the one a real deployment should pin to — it's immutable and traceable to an exact commit.

**Caching** uses GitHub Actions cache (`type=gha`) scoped per image, so the frontend and backend don't evict each other's layers.

### Retargeting at AWS ECR

If the Terraform config is ever applied, switching to ECR is a small change: replace the `REGISTRY` env and swap `docker/login-action` for `aws-actions/amazon-ecr-login`, authenticated by an OIDC role rather than stored keys. See [TERRAFORM.md](TERRAFORM.md).

## `k8s-validate.yml` — manifest validation (new)

Triggers on changes under `k8s/**`. Two independent checks:

```
1. kubeconform -strict -summary -kubernetes-version 1.30.0 k8s/*.yaml
     → validates every manifest against the real Kubernetes OpenAPI schema.
       Genuinely cluster-less.

2. helm/kind-action → ephemeral kind cluster
   kubectl apply --dry-run=server -f <each manifest>
     → the real API server's admission chain validates the request
       without persisting anything. Cluster is destroyed with the runner.
```

**This workflow deliberately does not deploy anywhere.** There is no cloud cluster and no credentials.

### Why a real (disposable) cluster instead of `--dry-run=client`

Because `--dry-run=client` isn't actually cluster-less. It still contacts the API server to resolve resource schemas. Verified locally before writing this workflow:

```
$ kubectl apply --dry-run=client -f k8s/namespace.yaml
error: error validating "namespace.yaml": failed to download openapi:
... Authentication required
```

So a throwaway `kind` cluster is the honest way to get this check working in CI — and server-side dry-run is strictly more thorough anyway, since it exercises real admission control.

## Secrets handling

No workflow hardcodes any credential. What's used:

| Secret | Source | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | Automatic, per-run, scoped by `permissions:` | GHCR push |
| `JWT_SECRET` (backend job) | Inline, disposable, CI-only | Satisfies startup validation |
| `POSTGRES_PASSWORD` (service) | Inline, disposable, CI-only | Ephemeral service container |
| `GRAFANA_ADMIN_PASSWORD` | Inline, disposable, CI-only | Compose interpolation only |

The inline values are genuinely disposable — they belong to containers that exist for one job and are never reachable from outside the runner. Real secrets (a production `DATABASE_URL`, a real `JWT_SECRET`) would go in GitHub Actions repository secrets and be referenced as `${{ secrets.NAME }}`, never committed.

`permissions:` is declared explicitly per job rather than relying on the default token scope — `contents: read` plus `packages: write` only where a push actually happens.

## What's deliberately absent

**No deployment workflow that actually deploys.** There's no cluster, no AWS account, and no hosting target with credentials available. A workflow that pretended to deploy — or that existed purely to have a file named `deploy.yml` — would be exactly the resume-padding this project avoids. The pieces that *would* be needed are in place: images are built and published with immutable tags, and manifests are validated. What's missing is only a cluster endpoint and its credentials.

**No `ansible-lint` / Ansible CI job.** Meaningful Ansible CI needs a real VM or privileged systemd container to converge against; the local verification in [ANSIBLE.md](ANSIBLE.md) (real container, real convergence, idempotency proven) is more valuable than a lint-only job.

**No `terraform plan` in CI.** `plan` requires real AWS credentials. `fmt` and `validate` don't, and could be added as a cheap job; they're currently run locally and documented in [TERRAFORM.md](TERRAFORM.md).

## Local equivalents

Everything CI does can be run locally before pushing:

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build   # frontend
cd backend && npm test && npm run build                          # backend
docker compose up -d --build                                     # integration
make scan                                                        # Trivy (needs trivy installed)
cd terraform && terraform fmt -recursive && terraform validate
cd ansible && ansible-playbook playbooks/site.yml --syntax-check
```
