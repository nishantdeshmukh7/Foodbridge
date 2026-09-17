# Networking

## Ports, in one table

| Port | Where | What listens | Public? |
|---|---|---|---|
| 8080 | frontend container | nginx (SPA + reverse proxy) | via published port / Ingress / ALB |
| 3001 | backend container | Express | **No** — internal network only |
| 5432 | database | PostgreSQL | **No** — internal network only |
| 5174 | host (dev compose) | → frontend:8080 | localhost |
| 4000 | host (dev compose) | → backend:3001 | localhost, **dev only** |
| 5433 | host (dev compose) | → db:5432 | `127.0.0.1` only |
| 9090 / 3000 / 8080 | host (dev compose) | Prometheus / Grafana / cAdvisor | `127.0.0.1` only |
| 80 / 443 | host (prod compose) | → frontend:8080 / 8443 | Yes |

Two things worth noting. **nginx listens on 8080, not 80** — the container runs as the non-root `nginx` user, and binding a port below 1024 is the one thing a non-root process genuinely cannot do without `NET_BIND_SERVICE`. Changing the port was preferable to granting a capability. The public-facing port is unchanged because the host maps 80→8080.

And **the backend's host port (4000) exists only in the dev compose file.** `docker-compose.prod.yml` publishes no backend port at all. That's load-bearing for security, not tidiness — see `TRUST_PROXY` below.

## How a request travels

### Docker Compose / Kubernetes

```
User types https://foodbridge.example.com
    │
    ▼
DNS  ── A/AAAA record → the host's (or load balancer's) IP
    │
    ▼
TCP three-way handshake on 443 (or 80)
    │
    ▼
TLS handshake (if terminated here or upstream)
    │
    ▼
nginx (frontend container, :8080)
    │  route by path:
    ├── /             → serves dist/index.html + JS/CSS from disk. try_files
    │                   falls back to index.html so client-side routes work
    │                   on a hard refresh
    ├── /nginx-health → answered by nginx itself, never touches the backend
    ├── /api/*        → proxy_pass http://backend:3001
    └── /health       → proxy_pass http://backend:3001
                            │
                            ▼
                    Docker embedded DNS (or CoreDNS in K8s)
                    resolves "backend" → container/pod IP
                            │
                            ▼
                    Express (:3001)
                      helmet → cors → json → metrics → rateLimit
                      → validate → controller → service
                            │
                            ▼
                    Prisma connection pool
                            │
                            ▼
                    PostgreSQL (:5432)
```

The response returns along the same path. nginx adds its security headers only to *its own* responses (the `/` and static-asset blocks), never to proxied `/api` responses — otherwise they'd duplicate or shadow what `helmet` already set.

### Kubernetes specifics

```
Ingress (nginx controller, host: foodbridge.local)
    │
    ▼
Service/frontend  ClusterIP :8080   ── kube-proxy load-balances across
    │                                   the Endpoints of matching pods
    ▼
Pod/frontend (2 replicas)
    │  nginx proxies /api → "backend:3001"
    ▼
Service/backend   ClusterIP :3001   ── CoreDNS resolves
    │                                   backend.foodbridge.svc.cluster.local
    ▼
Pod/backend (2 replicas, HPA 2→5)
    │
    ▼
Service/postgres  ClusterIP :5432 → Pod/postgres
```

A `ClusterIP` Service is a stable virtual IP plus a DNS name. Pods are ephemeral — their IPs change on every restart — so nothing addresses a pod directly. kube-proxy handles the actual load balancing at the node's packet level.

### AWS (Terraform target)

```
Route 53 → ALB DNS name (public subnets, 2 AZs)
    │
    ▼
ALB, listener :443 (ACM cert) — :80 redirects 301 → :443
    │  listener rules:
    ├── /api/*, /health  → backend target group  :3001
    └── everything else  → frontend target group :8080
                              │
                              ▼
                     ECS Fargate tasks, private subnets,
                     assign_public_ip = false, target_type = "ip"
                              │
                              ▼
                     RDS PostgreSQL :5432, private, not publicly accessible
```

One intentional difference: **the ALB routes `/api/*` directly to the backend**, bypassing nginx's proxy. That's the AWS-native pattern — the load balancer does the routing a reverse proxy would otherwise do. It needs no `nginx.conf` change; nginx simply never sees those paths in that topology.

## TCP/IP

Everything here is TCP — HTTP/HTTPS and PostgreSQL's wire protocol both need ordered, reliable delivery, so UDP isn't a consideration.

An IPv4/IPv6 detail caused a **real production bug** in this repo, which is worth recording as a concrete example of why address families matter:

`docker-compose.prod.yml`'s backend healthcheck used `http://localhost:3001/health`. In `node:alpine`, `/etc/hosts` maps `localhost` to *both* `127.0.0.1` and `::1`, and busybox wget attempts IPv6 first. But `backend/src/index.ts` binds with `app.listen(port, '0.0.0.0')` — IPv4 only. Every probe therefore hit a closed IPv6 socket:

```
Connecting to localhost:3001 ([::1]:3001)
wget: can't connect to remote host: Connection refused
```

The container never became healthy, and because `frontend` gates on `depends_on: condition: service_healthy`, it could never start. Fixed by pinning the probe to `127.0.0.1`. `nginx.conf` avoids the same trap by explicitly declaring `listen [::]:8080` next to its IPv4 listener. See [SECURITY.md](SECURITY.md) for the full write-up.

## DNS

Three distinct layers, easy to conflate:

1. **Public DNS** — maps your domain to the host/ALB IP. Not managed by this repo; Route 53 appears in the Terraform design only as an optional `domain_name` variable.
2. **Docker embedded DNS** (127.0.0.11) — resolves *service names* within a Compose project. This is why `proxy_pass http://backend:3001` works with no configuration: `backend` is the service name in the compose file.
3. **CoreDNS** (Kubernetes) — resolves `<service>.<namespace>.svc.cluster.local`, with short names resolving within the same namespace. This is why the K8s backend Service is deliberately named `backend` on port 3001: it makes the *exact same* `nginx.conf` work in both Compose and Kubernetes, with no image rebuild.

That naming alignment is the single most important networking decision in this repo — rename the Service and the frontend breaks.

## HTTP/HTTPS and TLS

The repo ships **plain HTTP by default, deliberately.** A config referencing certificate files that don't exist would fail to start out of the box. Two supported paths, both documented in `nginx.conf`:

- **Terminate at nginx** — enable the commented HTTPS server block (`listen 8443 ssl`, mapped from host 443), mount real certs read-only, turn on HSTS. Note 8443, not 443, for the same non-root reason as 8080.
- **Terminate upstream** — a cloud load balancer or CDN terminates TLS and forwards plain HTTP to this container over the platform's internal network. Simpler and more common for small deployments; HSTS and the HTTP→HTTPS redirect then belong at that upstream layer. This is what the Terraform ALB design does (ACM certificate, TLS 1.2/1.3 only, automatic 301 from :80).

The repo never generates or manages certificates.

## Load balancing

| Topology | Mechanism | Algorithm | Health check |
|---|---|---|---|
| Compose | None (single container per service) | — | Docker healthcheck |
| Kubernetes | Service + kube-proxy across pod Endpoints | Round-robin (iptables/IPVS) | Readiness probe gates Endpoint membership |
| AWS | ALB across target groups | Round-robin (least-outstanding available) | Target group health check |

The K8s detail that matters: **a pod only receives traffic once its readiness probe passes**, because failing readiness removes it from the Service's Endpoints. Combined with `maxUnavailable: 0`, a rolling update never sends traffic to a pod that isn't ready, and never dips below the current replica count.

Health-check endpoints are deliberately split by layer:

- `/nginx-health` — answered by nginx alone. Proves the proxy process is up.
- `/health` — proxied to the backend, which runs `SELECT 1` against Postgres. Proves the *whole stack* works.

The frontend's healthcheck uses `/nginx-health` on purpose. Using `/health` would make the frontend report unhealthy for a database problem that isn't nginx's fault — mixing up failure layers is exactly what makes on-call debugging slow.

## `TRUST_PROXY` — why the number must be exact

Express's `trust proxy` setting determines where `req.ip` comes from, and `express-rate-limit` keys its buckets on `req.ip`.

- **Too low** (e.g. `0` behind a proxy): every request appears to come from the proxy's IP, so *all* clients share one rate-limit bucket. One noisy user locks out everyone.
- **Too high**: Express trusts more `X-Forwarded-For` entries than there are real proxy hops, letting a client **forge** its apparent IP by sending its own `X-Forwarded-For` — bypassing rate limiting entirely.

Correct values per topology: **1** for Compose and Kubernetes (nginx/Ingress is the only hop); **2** for ECS behind an ALB (ALB + `awsvpc` networking).

What makes `1` trustworthy in the Compose topology is that nginx uses `$proxy_add_x_forwarded_for` (not `$http_x_forwarded_for`), which *appends* nginx's own socket-level view of the peer. A client cannot forge `$remote_addr`. With `trust proxy = 1`, Express reads only the rightmost entry — exactly the one nginx appended. A spoofed client value can only appear earlier in the chain, where it is ignored.

**This protection depends entirely on the backend being unreachable except through nginx.** If the backend published a host port, an attacker could bypass nginx and send a forged `X-Forwarded-For` directly. That is why `docker-compose.prod.yml` publishes no backend port — the two settings are a single security decision, not two independent ones.

## Firewalls and security groups

**Host level (Ansible, `roles/firewall`)** — UFW, `default deny incoming`. Opens only 80, 443, and SSH (with `rule: limit` to rate-limit connection attempts). Port 9100 (node_exporter) opens only if `monitoring_source_cidr` is set; it defaults to empty, so the rule is skipped rather than exposed to `0.0.0.0/0`.

**AWS (Terraform, `modules/security`)** — three chained security groups:

```
Internet ──80/443──▶ [ALB SG] ──8080/3001──▶ [ECS tasks SG] ──5432──▶ [RDS SG]
```

Rules reference *security group IDs*, not CIDRs, so they stay correct as IPs change. Only the ALB's SG allows `0.0.0.0/0`.

**Kubernetes** — no NetworkPolicies are defined, which is worth stating plainly: in this cluster any pod can reach any other pod. Reachability from *outside* is properly restricted (`ClusterIP` Services, single Ingress), but there is no intra-cluster segmentation. A production cluster should add NetworkPolicies — e.g. allow ingress to `backend` only from `frontend`, and to `postgres` only from `backend`. Not added here because Minikube's default CNI does not enforce them, so shipping them would give the appearance of a control that isn't actually active.

## Public vs private networks

The consistent principle across all three topologies: **exactly one public entry point, and no data or compute tier directly reachable from the internet.**

| | Public | Private |
|---|---|---|
| Compose | nginx (the only published port in prod) | backend, database |
| Kubernetes | Ingress | backend, postgres (`ClusterIP`) |
| AWS | ALB, NAT Gateways (public subnets) | ECS tasks, RDS (private subnets, `assign_public_ip=false`) |

In AWS, private subnets reach the internet outbound-only, via NAT Gateway — needed to pull images from ECR and read Secrets Manager. There is no inbound route from the internet to them at all.

## VPN

No VPN is configured, and none is needed for this architecture — the public surface is intentionally one HTTP(S) entry point.

Where a VPN (or AWS Systems Manager Session Manager, or a bastion host) *would* belong: administrative access to private resources. Connecting a `psql` client to the RDS instance, or getting a shell on a Fargate task, requires reaching a private subnet. The options, roughly in order of preference: **SSM Session Manager** (no open ports, no SSH keys, fully audited — the modern default), **Client VPN** (if many people need broad private-network access), or a **bastion host** (simplest, but another internet-facing machine to patch). For local development none of this applies: `docker compose` and `kubectl port-forward` provide the equivalent access.

## Troubleshooting

**"Connection refused" between containers.** Check the service/hostname spelling first (`backend`, not `localhost` — inside a container, `localhost` is that container). Then confirm both are on the same network: `docker compose ps`, `docker network inspect foodbridge_default`.

**Frontend loads but API calls 404 or go to the wrong host.** `VITE_API_URL` is baked in at *build* time, not read at runtime. A frontend image built with the dev default (`http://localhost:4000/api`) will have the browser try to reach the user's own laptop. Rebuild with `--build-arg VITE_API_URL=/api`.

**Healthcheck fails but the app works.** Check the address family — see the TCP/IP section above. `localhost` inside a container may resolve to `::1` while the process listens only on IPv4.

**Rate limiting hits everyone at once, or not at all.** `TRUST_PROXY` doesn't match the real hop count. See above.

**Useful commands.**
```bash
docker compose exec frontend wget -qO- http://backend:3001/health   # container-to-container
docker network inspect foodbridge_default
kubectl -n foodbridge get endpoints            # are pods actually behind the Service?
kubectl -n foodbridge exec deploy/frontend -- wget -qO- http://backend:3001/health
kubectl -n foodbridge port-forward svc/frontend 18080:8080
lsof -nP -iTCP:8080 -sTCP:LISTEN               # what's holding a host port
```
