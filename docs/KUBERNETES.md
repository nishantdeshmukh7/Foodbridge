# Kubernetes

Manifests in `k8s/`, written for and **actually tested on** a local Minikube cluster.

## What's here

| File | Contents |
|---|---|
| `namespace.yaml` | `foodbridge` namespace |
| `configmap.yaml` | Non-secret backend config (`NODE_ENV`, `PORT`, `TRUST_PROXY`, `FRONTEND_URL`, …) |
| `secret.example.yaml` | **Placeholders only** — copy to `secret.yaml` (gitignored) and fill in |
| `postgres.yaml` | Local-testing-only Postgres: Deployment + PVC + Service |
| `backend-deployment.yaml` | Backend Deployment (2 replicas) + Service `backend:3001` |
| `frontend-deployment.yaml` | Frontend Deployment (2 replicas) + Service `frontend:8080` |
| `ingress.yaml` | Single public entry point, host `foodbridge.local` |
| `hpa.yaml` | Backend HPA, 2→5 replicas at 70% CPU |

## Design decisions worth knowing

**The backend Service is named `backend` on port 3001 deliberately.** `nginx.conf` — baked into the frontend image — already proxies to `http://backend:3001`. Matching that name and port here means the *same image* works in Docker Compose and Kubernetes with no rebuild and no config patching. Rename the Service and the frontend breaks.

**The Ingress has no `/api` rule.** It routes everything to the frontend Service, which already proxies `/api` and `/health` to the backend. Adding an `/api` Ingress rule would be a second redundant proxy hop doing the same job.

**Postgres is a Deployment, not a StatefulSet, and that's a deliberate scope limit.** It exists so the stack can be exercised end-to-end locally. A single `ReadWriteOnce` PVC with `strategy: Recreate` is fine for disposable local testing where `minikube delete` losing the volume is expected. It has no replication or backup story and is **not** a production pattern — mirroring `docker-compose.prod.yml`, which deliberately runs no database container at all. A real deployment points `DATABASE_URL` at managed Postgres (RDS — see [TERRAFORM.md](TERRAFORM.md)).

**Security context mirrors the Docker hardening exactly:** `runAsNonRoot`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `readOnlyRootFilesystem: true`, with `emptyDir` mounts only where each process genuinely writes (`/tmp` for the backend; `/var/cache/nginx`, `/var/run`, `/tmp` for nginx). Resource requests/limits come from the same real `docker stats` observations already documented in `docker-compose.prod.yml`, not from guesswork.

**Probes reuse the endpoints that already exist:** backend readiness/liveness hit `/health` (which checks *real database connectivity*, not just process liveness); frontend probes hit `/nginx-health` (answered by nginx itself). That split matters — using `/health` for the frontend would make it report unhealthy for a database problem that isn't nginx's fault.

**Only the backend autoscales.** The frontend serves static files and proxies — it never approaches its limits, so an HPA on it would be complexity with no benefit.

## Deploying to Minikube

```bash
minikube start --driver=docker
minikube addons enable ingress
minikube addons enable metrics-server     # required for the HPA

# Build images and load them into the cluster.
# VITE_API_URL=/api is required - it makes the frontend call the API
# same-origin through its own nginx proxy. The dev-default
# (http://localhost:4000/api) would break inside the cluster.
docker build -t foodbridge-backend:local ./backend
docker build -t foodbridge-frontend:local --build-arg VITE_API_URL=/api .
minikube image load foodbridge-backend:local
minikube image load foodbridge-frontend:local

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml

# Create your own secret - NEVER apply secret.example.yaml as-is.
cp k8s/secret.example.yaml k8s/secret.yaml
#   generate a real JWT secret:
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
$EDITOR k8s/secret.yaml
kubectl apply -f k8s/secret.yaml

kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml
```

### Verify

```bash
kubectl -n foodbridge rollout status deploy/backend
kubectl -n foodbridge rollout status deploy/frontend
kubectl -n foodbridge get pods,svc,ingress,hpa
```

### Reach the app

```bash
# Simplest, works everywhere including the macOS docker driver:
kubectl -n foodbridge port-forward svc/frontend 18080:8080
curl http://localhost:18080/          # SPA
curl http://localhost:18080/health    # proxied through to the backend
```

Or via the Ingress host: add `$(minikube ip) foodbridge.local` to `/etc/hosts`, then `curl http://foodbridge.local/`. On the macOS docker driver this also needs `minikube tunnel` running in a separate terminal — port-forward is less fuss.

## Verified working

Real output from a real cluster, not illustrative:

```
$ kubectl -n foodbridge get pods
NAME                        READY   STATUS    RESTARTS   AGE
backend-69fc87776b-kx4h6    1/1     Running   0          23s
backend-69fc87776b-nw4mm    1/1     Running   0          23s
frontend-c764d8554-564jm    1/1     Running   0          2m25s
frontend-c764d8554-lmz28    1/1     Running   0          2m25s
postgres-7ff799f47f-g6z5f   1/1     Running   0          23s

$ curl http://localhost:18080/health
{"status":"ok","timestamp":"...","uptimeSeconds":22.1,"database":"ok"}

$ kubectl -n foodbridge get hpa
NAME      REFERENCE            TARGETS       MINPODS   MAXPODS   REPLICAS
backend   Deployment/backend   cpu: 1%/70%   2         5         2
```

`database: ok` in that health response is the meaningful part — it proves the backend genuinely reached Postgres through the cluster's Service DNS, not merely that the process was alive.

## Troubleshooting

### The one real problem hit during this work: `Init:CrashLoopBackOff` on the backend

**Symptom.** Backend pods sat in `Init:Error` → `Init:CrashLoopBackOff` for the first ~50 seconds after a fresh deploy, then recovered on their own.

**Diagnosis.**

```bash
$ kubectl -n foodbridge logs deploy/backend -c migrate
Error: P1001: Can't reach database server at `postgres:5432`
```

**Root cause.** Kubernetes has no equivalent of Compose's `depends_on: condition: service_healthy`. The backend Deployment's pods are scheduled immediately, independently of whether the Postgres Deployment has finished first-boot initialization — which, on a fresh PVC, takes ~50s. The `migrate` initContainer therefore ran against a database that wasn't listening yet.

**Fix.** A `wait-for-postgres` initContainer that polls the port before `migrate` runs:

```yaml
initContainers:
  - name: wait-for-postgres
    image: busybox:1.36
    command: ["sh", "-c", "until nc -z -w2 postgres 5432; do echo waiting; sleep 2; done"]
  - name: migrate
    ...
```

**Verified.** Deleted the Deployments and PVC, redeployed from scratch: `successfully rolled out`, **0 restarts**. The race was real, and is now deterministic rather than relying on crash-loop backoff to eventually get lucky.

### HPA shows `cpu: <unknown>/70%`

Normal for the first minute or two, and after pods are recreated — metrics-server needs a couple of collection cycles. Confirm with `kubectl top pods -n foodbridge`; if that returns data, the HPA will catch up shortly. `kubectl -n foodbridge describe hpa backend` shows `ScalingActive: True / ValidMetricFound` once it has. If it never resolves, `minikube addons enable metrics-server`.

### `ErrImagePull` / `ImagePullBackOff`

The manifests use `imagePullPolicy: IfNotPresent` with `:local` tags that exist only inside the cluster. Re-run `minikube image load foodbridge-{backend,frontend}:local`, and confirm with `minikube image ls | grep foodbridge`.

### Frontend loads but API calls fail

Almost always the frontend image was built without `--build-arg VITE_API_URL=/api`. Vite bakes that value in at **build** time, so a dev-default of `http://localhost:4000/api` ships inside the bundle and the browser tries to reach the developer's laptop. Rebuild with the build arg and reload the image.

### Pod is `Running` but not `Ready`

Readiness is failing. `kubectl -n foodbridge describe pod <name>` shows the probe failure. For the backend this usually means `/health` is returning 503 because the database is unreachable — check `DATABASE_URL` in your Secret and that the Postgres pod is ready.

### Useful commands

```bash
kubectl -n foodbridge describe pod <pod>          # events, probe failures, OOMKilled
kubectl -n foodbridge logs <pod> -c migrate       # a specific init container
kubectl -n foodbridge logs <pod> --previous       # logs from a crashed prior container
kubectl -n foodbridge get events --sort-by=.lastTimestamp
kubectl -n foodbridge rollout undo deploy/backend # roll back a bad deploy
```

## CI validation

`.github/workflows/k8s-validate.yml` validates these manifests on every change:

1. **kubeconform** — schema validation against the real Kubernetes OpenAPI spec, no cluster needed.
2. **`kubectl apply --dry-run=server`** against an ephemeral `kind` cluster created and destroyed inside the job.

Note on why step 2 uses a real (disposable) cluster: `kubectl --dry-run=client` sounds cluster-less but isn't — it still contacts the API server to resolve resource schemas. Verified locally:

```
$ kubectl apply --dry-run=client -f k8s/namespace.yaml
error: ... failed to download openapi: ... Authentication required
```

So a throwaway `kind` cluster is the honest way to get server-side validation in CI. Nothing is deployed anywhere persistent.

## Teardown

```bash
kubectl delete namespace foodbridge   # removes everything in it
minikube stop                          # or: minikube delete
```
