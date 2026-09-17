# Troubleshooting

Problems are grouped by where they surface. Items marked **[hit during this work]** are real failures encountered and fixed, not hypotheticals.

## Local development

### `npm test` fails: "DATABASE_URL is not set"

Backend tests need a real PostgreSQL database — deliberately, since mocked database tests pass while real migrations break. One-time setup:

```bash
docker compose up -d db
docker exec foodbridge-db createdb -U postgres foodbridge_test
cd backend
DATABASE_URL="postgresql://postgres:password@localhost:5433/foodbridge_test?schema=public" \
  npx prisma migrate deploy
```

Then run tests with that `DATABASE_URL` and a `JWT_SECRET` of at least 32 characters. Note `5433` — the dev compose file maps Postgres to `127.0.0.1:5433`, not 5432, to avoid clashing with a local Postgres install. The test setup (`backend/src/test/setup.ts`) also force-rewrites the database name to end in `_test`, so tests can never run against real data.

### `npx vitest` fails: "Cannot find package 'vitest'"

**[hit during this work]** Frontend dependencies aren't installed. The error is confusing because vitest resolves upward and reports a path in your home directory.

```bash
npm ci --legacy-peer-deps
```

`--legacy-peer-deps` is required by this dependency tree — plain `npm ci` will fail on peer conflicts.

### Backend refuses to start: "JWT_SECRET is ..."

Working as designed. The backend validates `JWT_SECRET` at startup and exits if it's missing, under 32 characters, or a known placeholder (`your-secret-key`, `change-me`, etc.).

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Backend exits: "FATAL: ... no configured frontend origin"

`FRONTEND_URL` is mandatory in production — the server refuses to start rather than fall back to a dev CORS default that would reject all real requests.

## Docker

### Compose fails: "required variable GRAFANA_ADMIN_PASSWORD is missing"

**[hit during this work]** Grafana's admin password deliberately has no default (it used to default to the literal `admin`). The surprising part: **this blocks even `docker compose up db backend frontend`**, because Compose interpolates *every* service's environment before filtering to the services you named.

```bash
echo 'GRAFANA_ADMIN_PASSWORD=pick-something-local' >> .env   # .env is gitignored
```

### "ports are not available: address already in use"

**[hit during this work]** — an unrelated process held 8080, which cAdvisor wants.

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN     # identify the holder
```

Either stop that process, or remap the port with a local override file (don't edit the committed compose file):

```yaml
# override.yml — note `!override`, because Compose APPENDS port lists by default
services:
  cadvisor:
    ports: !override
      - "127.0.0.1:8081:8080"
```
```bash
docker compose -f docker-compose.yml -f override.yml up -d
```

The `!override` tag matters: without it, Compose merges the lists and the container ends up trying to bind *both* ports.

### `docker-compose.prod.yml`: frontend never starts, backend "unhealthy"

**[hit during this work — this was a real bug, now fixed]**

If you see this on an older checkout:

```
dependency failed to start: container foodbridge-backend-prod is unhealthy
```

and the probe log shows:

```
Connecting to localhost:3001 ([::1]:3001)
wget: can't connect to remote host: Connection refused
```

The cause is an IPv4/IPv6 mismatch: `node:alpine` maps `localhost` to both `127.0.0.1` and `::1`, busybox wget tries IPv6 first, but the server binds `0.0.0.0` (IPv4 only). Because `frontend` gates on `depends_on: condition: service_healthy`, it could never start.

Fixed by pinning the healthcheck to `http://127.0.0.1:3001/health`. A regression test in `src/test/container-hardening.test.ts` now guards it. Diagnose this class of problem with:

```bash
docker inspect <container> --format '{{json .State.Health}}' | python3 -m json.tool
docker exec <container> wget -qO- http://127.0.0.1:3001/health   # vs localhost
```

### Container exits immediately

```bash
docker compose logs backend          # the reason is almost always here
docker compose ps                    # exit code
```

Common causes: failed startup validation (`JWT_SECRET`/`FRONTEND_URL`), unreachable `DATABASE_URL`, or a failed `prisma migrate deploy`.

### "read-only file system" errors

The production containers run with `read_only: true` and tmpfs mounts only where each process genuinely writes. If new code needs to write somewhere else, add a specific tmpfs mount for that path — don't remove `read_only`.

Note the nginx tmpfs mounts use the long form with `mode: 0o1777`. A bare tmpfs mount is created root-owned, which the non-root nginx user then can't write into (`mkdir() permission denied on /var/cache/nginx/client_temp`).

## Kubernetes

### Backend pods stuck in `Init:CrashLoopBackOff`

**[hit during this work — fixed]**

```bash
kubectl -n foodbridge logs deploy/backend -c migrate
# Error: P1001: Can't reach database server at `postgres:5432`
```

Kubernetes has no equivalent of Compose's `depends_on: condition: service_healthy`. The backend's pods are scheduled immediately, regardless of whether the Postgres Deployment has finished first-boot initialization (~50s on a fresh PVC). The `migrate` initContainer ran against a database that wasn't listening.

Fixed with a `wait-for-postgres` initContainer that polls the port first. Verified from scratch (deleted Deployments + PVC, redeployed): rolled out cleanly with **0 restarts**.

### `ErrImagePull` / `ImagePullBackOff`

The manifests use `:local` tags that exist only inside the cluster, with `imagePullPolicy: IfNotPresent`.

```bash
minikube image load foodbridge-backend:local
minikube image load foodbridge-frontend:local
minikube image ls | grep foodbridge      # confirm
```

### HPA shows `cpu: <unknown>/70%`

**[hit during this work — resolved on its own]** Normal for the first minute or two, and after pods are recreated. metrics-server needs a few collection cycles.

```bash
kubectl top pods -n foodbridge                       # if this works, HPA will catch up
kubectl -n foodbridge describe hpa backend           # want: ScalingActive True / ValidMetricFound
minikube addons enable metrics-server                # if it never resolves
```

### Pod `Running` but not `Ready`

Readiness is failing. `kubectl -n foodbridge describe pod <name>` shows the probe error. For the backend this usually means `/health` returns 503 because the database is unreachable — check `DATABASE_URL` in your Secret.

### Frontend loads but API calls fail

`VITE_API_URL` is baked in at **build** time. Rebuild with `--build-arg VITE_API_URL=/api` and reload the image. A bundle built with the dev default makes the browser try to reach `localhost:4000` — i.e. the user's own machine.

### Can't reach the app via `foodbridge.local`

On the macOS docker driver the Ingress IP isn't directly routable. Simplest path:

```bash
kubectl -n foodbridge port-forward svc/frontend 18080:8080
```

For the Ingress host instead: add `$(minikube ip) foodbridge.local` to `/etc/hosts` and run `minikube tunnel` in a separate terminal.

### General K8s debugging

```bash
kubectl -n foodbridge describe pod <pod>            # events, probe failures, OOMKilled
kubectl -n foodbridge logs <pod> --previous         # logs from a crashed prior container
kubectl -n foodbridge logs <pod> -c <init-container>
kubectl -n foodbridge get events --sort-by=.lastTimestamp
kubectl -n foodbridge get endpoints                 # are pods actually behind the Service?
kubectl -n foodbridge rollout undo deploy/backend   # roll back
```

## Terraform

### `terraform plan` fails with `InvalidClientTokenId`

**Expected.** This project has no AWS account. `fmt`, `init -backend=false`, and `validate` all work without credentials; `plan` and `apply` require them. See [TERRAFORM.md](TERRAFORM.md).

### `terraform fmt` keeps reporting changes

`terraform fmt` rewrites files in place — run `terraform fmt -recursive` once and commit the result. Use `-check` in CI to fail on unformatted files without modifying them.

## Ansible

### `'app_user' is undefined`

**[hit during this work]** `group_vars/` must sit **next to the inventory file**, not at the playbook or project root. This repo puts it at `ansible/inventory/group_vars/all.yml` for that reason. If you pass a custom inventory from elsewhere (e.g. `-i /tmp/hosts.ini`), its `group_vars` won't be found — pass the vars explicitly with `-e @inventory/group_vars/all.yml`.

### "Ansible requires blocking IO on stdin/stdout/stderr"

**[hit during this work]** Ansible refuses to run with non-blocking file handles, which some automation environments produce. Wrap the command:

```bash
script -q /dev/null ansible-playbook playbooks/site.yml --syntax-check
```

### "The 'community.general.yaml' callback plugin has been removed"

**[hit during this work]** Removed in `community.general` 12.0.0. Replaced in `ansible.cfg` by the built-in equivalent:

```ini
stdout_callback = default
result_format = yaml
```

### Playbook reports `changed` on every run

Not idempotent. Typical culprits: a `command`/`shell` task without `changed_when: false` or a `creates:` guard; `get_url` without `force: false`; a template whose rendered content differs each run. Diagnose with `--check --diff`.

### Testing locally without a VM

macOS isn't a valid target (these are Debian/systemd tasks). Use a systemd-capable container:

```bash
docker run -d --name ansible-test-host --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  geerlingguy/docker-ubuntu2204-ansible:latest

cd ansible
ansible-playbook -i inventory/test-docker.ini -c community.docker.docker playbooks/site.yml
```

`--privileged` and the cgroup mount are needed because the playbook manages real systemd units.

## Monitoring

### cAdvisor panels are empty in Grafana

**Expected on Docker Desktop for Mac.** cAdvisor needs the container runtime's socket to resolve container *names*, and Docker Desktop doesn't expose containerd's socket to the host, so it emits only cgroup ids. Works normally on a Linux host. Full explanation and the macOS-compatible query in [MONITORING.md](MONITORING.md).

### `histogram_quantile(...)` returns `NaN`

**[hit during this work]** Not a bug — `rate()` needs at least two samples in the window. A single burst of requests yields `NaN`. Generate sustained traffic and wait a couple of scrape intervals (~30s).

### A Prometheus target shows `health=down`

Check `http://localhost:9090/targets` for the actual error, then test from inside the network:

```bash
docker compose exec prometheus wget -qO- http://backend:3001/metrics | head
```

### Grafana panels empty but Prometheus has data

Usually the dashboard time range (`now-1h` on a freshly started stack). Otherwise verify the datasource: Grafana → Connections → Data sources → Prometheus → *Save & test*.

## CI

### `kubectl apply --dry-run=client` fails in CI with "Authentication required"

**[hit during this work]** `--dry-run=client` is not actually cluster-less — it contacts the API server to resolve resource schemas. This is why `k8s-validate.yml` uses `kubeconform` (genuinely schema-only) plus `--dry-run=server` against an ephemeral `kind` cluster.

### Trivy reports vulnerabilities but CI passes

Intentional: `exit-code: '0'` makes scan results reporting-only, so an upstream base-image CVE doesn't block unrelated PRs. The trade-off is that someone must read the output. See [SECURITY.md](SECURITY.md).

### Docker publish workflow doesn't push on a PR

By design. Fork PRs don't get write-scoped tokens, and pushing an image from unreviewed code would be an unwanted side effect. The build still runs, so a broken Dockerfile fails the PR.

## Quick reference

```bash
# Full local stack
docker compose up -d --build

# Production-style stack (needs an env file with DATABASE_URL, JWT_SECRET, FRONTEND_URL)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Everything CI checks
npm run lint && npx tsc --noEmit && npm test && npm run build
cd backend && npm test && npm run build
cd terraform && terraform fmt -recursive && terraform validate
cd ansible && ansible-playbook playbooks/site.yml --syntax-check

# Teardown
docker compose down -v
kubectl delete namespace foodbridge
minikube stop
```
