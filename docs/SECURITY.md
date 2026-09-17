# Security

This is a record of an audit that was actually performed, including the things that came back clean, the one real bug it found, and the risks that remain open. Findings are stated as they are rather than presented as a finished checklist.

## Audit results

### Secrets and git history — clean

| Check | Result |
|---|---|
| Real `.env` tracked in git? | **No.** Only `.env.example` and `backend/.env.example`, which contain placeholders |
| `.env` ever committed and later removed? | **No.** `git log --diff-filter=A` across all 19 commits finds no `.env`, `.env.production`, or `.env.local` ever added |
| AWS access keys in history? | **No.** Scanned every commit for `AKIA[0-9A-Z]{16}` — no matches |
| Private keys in history? | **No.** Scanned every commit for PEM private-key headers — no matches |
| Gitignore coverage | `.env*`, `k8s/secret.yaml`, `*.tfstate`, `terraform/terraform.tfvars`, `backups/`, `*.dump` all ignored; `*.example` files correctly *not* ignored |

Verified that the example templates stay tracked while the real files are ignored — a `.gitignore` that accidentally swallows the template is a common and annoying failure.

### Secret handling at runtime — strong

- `JWT_SECRET` is validated at startup (`backend/src/config/index.ts`): the process **refuses to start** if it is missing, shorter than 32 characters, or matches a maintained list of placeholder values that have appeared in this repo's own history. A developer copy-pasting `your-secret-key` gets a hard failure, not a working-but-guessable signing key.
- `FRONTEND_URL` is mandatory in production — the server exits rather than fall back to a dev CORS default.
- Grafana's admin password has **no default**. It previously defaulted to the literal `admin`; now the container refuses to start without an explicit value.
- Terraform generates the RDS password and `JWT_SECRET` in-config (`random_password`) and stores them in Secrets Manager. They never pass through a `.tfvars` file, shell history, or CI log.
- `k8s/secret.example.yaml` contains only `REPLACE_ME` placeholders. The real `secret.yaml` is gitignored.
- The admin-provisioning script (`backend/scripts/create-admin.ts`) masks password input and never logs it. No HTTP endpoint anywhere can create an `ADMIN` account.

### Container security — verified live, not assumed

Confirmed by inspecting actually-running production containers:

```
foodbridge-backend-prod   uid=1000(node)   CapDrop=[ALL] ReadonlyRootfs=true
                          SecurityOpt=[no-new-privileges:true] Mem=256MB  healthy
foodbridge-frontend-prod  uid=101(nginx)   CapDrop=[ALL] ReadonlyRootfs=true
                          SecurityOpt=[no-new-privileges:true] Mem=64MB   healthy
```

- **Non-root** in both images, via `USER` in the Dockerfile and enforced again by `runAsNonRoot` in Kubernetes.
- **Every Linux capability dropped.** nginx listens on 8080 rather than 80 specifically so it doesn't need `NET_BIND_SERVICE` — binding a privileged port is the one thing a non-root process genuinely cannot do, so the port was changed instead of the capability being granted.
- **Read-only root filesystem**, with tmpfs/`emptyDir` mounts only where each process actually writes (`/tmp`; plus `/var/cache/nginx` and `/var/run` for nginx).
- **`no-new-privileges`** blocks privilege gain via setuid binaries.
- **Resource limits** on both, sized from real `docker stats` observation. This is a security control as much as a capacity one — it bounds the blast radius of a memory-exhaustion bug or a runaway loop.
- **Backend publishes no host port** in production. Verified: `curl http://localhost:3001/health` from the host fails while the same request through nginx succeeds. It is reachable only as `backend:3001` on the internal network.
- **Multi-stage builds** mean the runtime image carries no build toolchain, no dev dependencies, and no source — `npm ci --omit=dev` plus the compiled `dist/`.

### Application security — already strong before this work

| Control | Implementation |
|---|---|
| Password hashing | bcrypt. Max length capped at 72 bytes — bcrypt's real limit, beyond which input is silently ignored |
| Password policy | Length-only (min 6, max 72), deliberately no complexity rules; one policy shared by registration, reset, and admin provisioning |
| Auth | JWT bearer tokens; `passwordChangedAt` invalidates tokens issued before a password change |
| Authorization | Role middleware plus per-route checks; public registration cannot assign `ADMIN` regardless of payload |
| Rate limiting | `express-rate-limit` scoped to login/register/mutations only — health checks and normal reads unaffected |
| Login throttling | Separate per-account throttle on top of IP rate limiting |
| Input validation | `express-validator` + `zod` |
| Security headers | `helmet` on the API; nginx adds CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` on frontend responses |
| CSP | `script-src 'self'` with **no** `unsafe-inline` (verified against the real build output). `style-src` needs `unsafe-inline` for Radix's runtime inline styles — documented, not silently permitted |
| CORS | Exact origin from `FRONTEND_URL`, never a wildcard; mandatory in production |
| SQL injection | Prisma parameterises everything; the only raw query is `SELECT 1` in the health check |
| Error handling | Generic 500s to clients; `/health` returns `database: unreachable` without ever leaking the connection string, credentials, or a stack trace (covered by a dedicated test) |
| Graceful shutdown | SIGTERM drains in-flight requests and closes the Prisma pool, with a bounded timeout |

### Kubernetes and IAM

- Backend and Postgres Services are `ClusterIP` — not reachable from outside the cluster. Only the Ingress is public.
- Pod `securityContext` mirrors the Docker hardening exactly.
- Terraform security groups are chained by **security-group reference**, not CIDR: only the ALB's SG allows `0.0.0.0/0`; the ECS SG accepts traffic only from the ALB's SG; the RDS SG accepts 5432 only from the ECS SG.
- IAM uses two separate roles. The Secrets Manager grant names the two exact secret ARNs — never `GetSecretValue` on `*`. The **task role has no policies attached at all**, because the application makes no AWS API calls; granting permissions "just in case" would defeat the point.

### The `/metrics` endpoint (added in this work)

`/metrics` is unauthenticated but structurally non-public: nginx proxies only `/api` and `/health`, the K8s backend Service is `ClusterIP`, and the AWS ALB has no listener rule matching it. It exposes route names, traffic volumes and error rates — reconnaissance material — so a test asserts it contains no connection string, no JWT secret, and no password material.

The label-cardinality guard is also a security control, not just an operational one: route labels are Express *patterns*, and unmatched paths collapse to `route="unmatched"` rather than echoing the requested URL. Without that, anyone could exhaust Prometheus's memory by requesting random URLs. Both behaviours are covered by tests.

## Bug found and fixed

**Production healthcheck failed against IPv6, preventing the frontend from ever starting.**

Found by actually running `docker compose -f docker-compose.prod.yml up` rather than reading the file.

- **Symptom:** `foodbridge-backend-prod` never became healthy. Because `frontend` gates on `depends_on: condition: service_healthy`, **the frontend container could never start at all.** The committed production compose file could not bring up a working stack.
- **Probe output:** `Connecting to localhost:3001 ([::1]:3001) / wget: can't connect to remote host: Connection refused`
- **Root cause:** `node:alpine`'s `/etc/hosts` maps `localhost` to both `127.0.0.1` and `::1`. busybox wget tries the IPv6 address first. But `backend/src/index.ts` binds the server to `0.0.0.0` — IPv4 only. So every probe hit a closed IPv6 socket. Confirmed by `wget http://127.0.0.1:3001/health` succeeding while `http://localhost:3001/health` failed in the same container.
- **Fix:** pin the healthcheck to the IPv4 loopback the process actually listens on. The frontend's healthcheck was checked and is **not** affected — `nginx.conf` explicitly declares `listen [::]:8080` alongside its IPv4 listener.
- **Verified:** the stack now reports `Healthy` and the frontend starts; end-to-end requests through nginx return 200 with `database: ok`.
- **Regression guard:** a test in `src/test/container-hardening.test.ts` asserts the backend healthcheck uses `127.0.0.1` and not `localhost`, with the reasoning inline so the next person doesn't "simplify" it back.

## Dependency vulnerabilities — current state, stated plainly

`npm audit`, run during this audit:

| Scope | Total | Severity | Packages |
|---|---|---|---|
| Frontend | 4 | all moderate | `vitest`, `@vitest/mocker`, `react-router`, `react-router-dom` |
| Backend | 2 | all moderate | `vitest`, `@vitest/mocker` |

**No critical or high advisories in either scope.**

**The `vitest` advisories (both scopes) are dev-only.** `@vitest/mocker` path traversal — a test-tooling package that is never installed into the runtime image (`npm ci --omit=dev`) and never reachable by a deployed request. The fix is a breaking major upgrade to `vitest@5`. Not taken: it would risk 640 passing tests for zero change in production exposure.

**The `react-router` advisories are runtime and warranted real investigation**, since `react-router-dom` ships inside the browser bundle. Two advisories:

1. *Arbitrary Constructor Injection via `deserializeErrors()` in SSR hydration* — **not applicable.** This app is a static SPA with no server-side rendering; the affected code path does not exist in this deployment.
2. *Open redirect via backslash in `<Link>`/`useNavigate` (GHSA-wrjc-x8rr-h8h6)* — **present but not reachable.** A library bug in how `useNavigate` handles a hostile string is only exploitable if the application ever passes it one. I independently audited every navigation call site (`grep` for `navigate(` and `<Navigate` across `src/`, excluding tests): all 19 pass either a hardcoded literal path, or a value derived from a closed enum (`user.role` ∈ {ADMIN, DONOR, NGO, VOLUNTEER}; `destinationFor()`, a `switch` over `NotificationType` returning literal paths or `null`). **No query parameter, `location.state`, URL fragment, or other free-text input reaches a navigation target anywhere in the codebase.** The repo already documents this analysis in `src/test/RedirectSafety.test.tsx`, and my independent check confirmed it still holds.

   **Remaining risk, honestly stated:** this is mitigated by application design, not by patching the library. The fix requires `react-router-dom@7`, a breaking major upgrade and a genuine application change beyond DevOps scope. If a future feature ever navigates to a user-supplied path, this becomes exploitable — so the upgrade should be scheduled, not indefinitely deferred.

## Automated security in CI

| Tool | Scope | Blocking? |
|---|---|---|
| **Trivy** | Both container images, OS + library, CRITICAL/HIGH, `ignore-unfixed` | **No** — `exit-code: '0'` |
| **ECR scan-on-push** | Images, if Terraform is ever applied | n/a |
| **kubeconform** | K8s manifests vs real Kubernetes schema | Yes |
| **`--dry-run=server`** | K8s manifests vs a real ephemeral API server | Yes |
| **ESLint / `tsc --noEmit`** | Frontend | Yes |
| Backend ESLint | — | **Missing** (see below) |

**Trivy being non-blocking is a real trade-off, not an oversight.** A new upstream CVE in `node:20-alpine` would otherwise block unrelated PRs through no fault of the change. The cost is that someone has to actually read the output. Flipping `exit-code` to `'1'` (optionally with `severity: CRITICAL` only) is the stricter posture and a one-line change.

## Known gaps and residual risk

1. **`react-router` open-redirect** — mitigated by design, not patched. Upgrade blocked by a breaking major version. Re-assess if navigation ever takes user input. *(Highest-priority remaining item.)*
2. **No backend ESLint config.** The backend has no lint step in CI — only `tsc`. A real gap, deliberately not fixed here because adding one would surface a batch of new findings across application code and expand this work well past DevOps scope. Flagged rather than silently ignored.
3. **Trivy non-blocking** — see above.
4. **`deletion_protection = false` and `skip_final_snapshot = true` in the RDS Terraform.** Correct for validate-only, dangerous in production. Must be flipped before any real apply; called out in `docs/TERRAFORM.md` too rather than left as a trap.
5. **Kubernetes Secrets are base64, not encrypted.** A `Secret` is not encryption at rest by default. A real cluster needs etcd encryption at rest and/or an external secret store (AWS Secrets Manager, which the Terraform design already uses). Documented in `secret.example.yaml` itself.
6. **No TLS by default.** nginx serves plain HTTP; the ALB is HTTP-only unless an ACM ARN is supplied. Deliberate — shipping a config referencing certificates that don't exist would fail to start. Both paths (terminate at nginx, or terminate upstream) are documented in `nginx.conf`.
7. **No Terraform static analysis** (`tfsec`/`checkov`). Would be genuinely useful; not added because it wasn't run, and listing an unrun tool would be padding.
8. **No secret scanning in CI** (gitleaks/trufflehog). History was audited manually and is clean, but that's a point-in-time check, not a gate against future commits.
9. **No SSH hardening in Ansible** (key-only auth, disable root login). Most cloud images ship sane defaults, and getting it wrong locks you out of the host — worth doing deliberately, not as a side effect.
10. **Structured logging absent.** Logs are `console.log`/`console.error` with no levels, JSON formatting, or correlation IDs. Security-relevant events (failed logins, admin actions) are recorded in the `AdminLog` table rather than emitted as structured audit logs. Adequate at this scale; noted as a limitation.

## What is deliberately not logged

Verified in the code: passwords, tokens, and password-reset links are never logged. The reset-email path is explicitly gated on `NODE_ENV === 'production'` so reset tokens cannot leak into production logs, and there is a dedicated test (`password-reset-token-logging.test.ts`) guarding it. The health check logs only the *fact* of a database failure, never the error object — a Prisma connection error can embed the connection string, credentials included.
