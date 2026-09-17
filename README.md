# FoodBridge

### Food Donation & Rescue Coordination Platform

FoodBridge is a full-stack web application that connects **Donors, NGOs, Volunteers, and Administrators** to coordinate food donations from creation to final delivery.

The platform provides a structured workflow for donating surplus food, allowing verified NGOs to claim donations, volunteers to coordinate pickups, and administrators to manage users, operations, and platform activity.

---

## Overview

FoodBridge addresses the coordination gap between people and organizations with surplus food and the NGOs and volunteers responsible for redistributing it.

The platform provides:

* **Donors** — create and manage food donations
* **NGOs** — discover and claim available donations
* **Volunteers** — accept pickup assignments and complete deliveries
* **Administrators** — manage users, donations, assignments, monitoring, and platform activity

The system enforces role-based authorization, ownership checks, transactional state transitions, contact-data privacy, and concurrency-safe operations across the donation and pickup lifecycle.

---

## Key Features

### Donation Management

* Create food donations with item details, quantity, location, expiry, urgency, and optional image
* View available donations
* Track donation status throughout its lifecycle
* Cancel eligible donations
* Manage NGO claims
* Release eligible claims back to the available pool

### NGO Operations

* Browse available food donations
* Claim available donations
* View and manage the NGO's own claims
* Release eligible claims
* Access donor contact information only when authorized by the donation relationship

### Volunteer Operations

* View available pickup opportunities
* Accept assigned pickup requests
* Record pickup and completion
* Track pickup status
* Access only the donor information required for an authorized pickup

### Administration

* Approve, reject, activate, and suspend users
* Assign volunteers to pickup requests
* Moderate eligible donations
* Monitor platform activity
* View operational analytics
* Review administrative activity logs

### Authentication & Account Management

* JWT-based authentication
* 24-hour configurable access-token expiry
* Role-based and approval-based authorization
* Secure password hashing
* Password recovery with time-limited, single-use reset tokens
* Password-change token invalidation
* Session invalidation after account suspension/rejection
* Multi-tab authentication synchronization
* Progressive login throttling
* Rate limiting on authentication and mutation endpoints

### Notifications

* Persistent in-app notifications
* Unread notification counts
* Mark individual notifications as read
* Mark all notifications as read
* Notifications generated from important platform events

### Privacy & Security

* Server-side authorization for every protected operation
* Ownership and relationship-based access control
* Protection against IDOR vulnerabilities
* Donation and pickup state-machine enforcement
* Atomic database operations for race-sensitive transitions
* Donor contact information redaction based on relationship
* Secure password-reset token storage
* Helmet security headers
* Explicit CORS configuration
* Production secret validation
* Reverse-proxy isolation of the backend
* Non-root Docker containers
* Read-only container filesystems
* Dropped Linux capabilities
* `no-new-privileges` container security
* Production database health checks

---

## Donation Lifecycle

The primary donation workflow is:

```text
DONOR
  │
  │ Create Donation
  ▼
AVAILABLE
  │
  │ NGO Claims
  ▼
CLAIMED
  │
  │ Volunteer Assignment
  ▼
PICKUP REQUEST
  │
  │ Volunteer Accepts
  ▼
ACCEPTED
  │
  │ Pickup
  ▼
PICKED_UP
  │
  │ Complete Delivery
  ▼
DELIVERED
```

Eligible donations can also be cancelled or released before a pickup has progressed beyond the permitted state.

All state transitions are validated and enforced server-side.

---

## User Roles

| Role          | Primary Responsibilities                                        |
| ------------- | --------------------------------------------------------------- |
| **Donor**     | Create donations, view own donations, cancel eligible donations |
| **NGO**       | Discover donations, claim food, manage own claims                |
| **Volunteer** | Accept pickups, collect donations, complete deliveries           |
| **Admin**     | Manage users, assignments, donations, analytics, and operations  |

User lifecycle states are controlled through approval and activation status:

```text
PENDING
   │
   ├── Reject ──► REJECTED
   │
   └── Approve ─► ACTIVE
                      │
                      └── Suspend ──► SUSPENDED
                                          │
                                          └── Activate ──► ACTIVE
```

---

## Technology Stack

### Frontend

* React
* TypeScript
* Vite
* React Router
* Tailwind CSS
* shadcn/ui
* Vitest

### Backend

* Node.js
* Express
* TypeScript
* Prisma ORM
* PostgreSQL
* JWT
* bcrypt

### Infrastructure & DevOps

* Docker (multi-stage builds, non-root, hardened)
* Docker Compose (dev/CI and production-style)
* Kubernetes (Minikube-tested: Deployments, Services, Ingress, HPA, probes)
* Terraform (AWS target architecture — **validated, never applied**; see below)
* Ansible (Linux host provisioning: Docker, UFW, node_exporter, auto-patching)
* Nginx (reverse proxy, security headers, CSP)
* GitHub Actions (CI, image publishing to GHCR, K8s manifest validation)
* Prometheus + Grafana + cAdvisor + node_exporter
* Trivy (container image scanning)

### Email

Password recovery uses a provider-agnostic email service boundary with SMTP support through Nodemailer.

---

## Architecture

FoodBridge uses a two-package architecture:

```text
┌──────────────────────────────────────┐
│              Browser                 │
│          React / TypeScript          │
└──────────────────┬───────────────────┘
                   │
                   │ HTTP / JSON
                   ▼
┌──────────────────────────────────────┐
│                Nginx                 │
│          Reverse Proxy / SPA         │
└──────────────────┬───────────────────┘
                   │
             /api + /health
                   │
                   ▼
┌──────────────────────────────────────┐
│          Express Backend             │
│                                      │
│  Auth │ Donations │ Pickups │ Admin │
│  Users │ Notifications │ Analytics   │
└──────────────────┬───────────────────┘
                   │
                 Prisma
                   │
                   ▼
┌──────────────────────────────────────┐
│             PostgreSQL               │
└──────────────────────────────────────┘
```

The backend is not directly exposed to the public network in the production Docker topology. External requests enter through Nginx, which serves the frontend and proxies API and health-check traffic to the backend.

---

## DevOps & Infrastructure

The same two container images run in three topologies — Docker Compose, Kubernetes, and (by design) AWS ECS Fargate. Full documentation lives in [`docs/`](docs/):

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, all three topologies, request flow, scalability |
| [DEVOPS_AUDIT.md](docs/DEVOPS_AUDIT.md) | Pre-work audit: what existed, what was missing |
| [CI_CD.md](docs/CI_CD.md) | The three GitHub Actions workflows |
| [KUBERNETES.md](docs/KUBERNETES.md) | Minikube setup, design decisions, troubleshooting |
| [TERRAFORM.md](docs/TERRAFORM.md) | AWS target architecture and its limitations |
| [ANSIBLE.md](docs/ANSIBLE.md) | Host provisioning roles and idempotency verification |
| [MONITORING.md](docs/MONITORING.md) | Three metric layers, dashboards, PromQL |
| [LOGGING.md](docs/LOGGING.md) | Current logging, what's never logged, what's deferred |
| [NETWORKING.md](docs/NETWORKING.md) | Ports, DNS, TLS, load balancing, `TRUST_PROXY` |
| [SECURITY.md](docs/SECURITY.md) | Security audit results, findings, residual risk |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Problems by area, including ones actually hit |
| [DEVOPS_IMPLEMENTATION_REPORT.md](docs/DEVOPS_IMPLEMENTATION_REPORT.md) | Everything done, tested, and still limited |

### Quick start (full stack with monitoring)

```bash
echo 'GRAFANA_ADMIN_PASSWORD=pick-something-local' >> .env   # required, no default
docker compose up -d --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5174 |
| Backend | http://localhost:4000/health · http://localhost:4000/metrics |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 → Dashboards → FoodBridge |
| cAdvisor | http://localhost:8080 |

All monitoring ports bind to `127.0.0.1` only. See [MONITORING.md](docs/MONITORING.md).

### Kubernetes (local)

```bash
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
kubectl -n foodbridge port-forward svc/frontend 18080:8080   # → http://localhost:18080
```

`VITE_API_URL=/api` is required — Vite bakes it in at **build** time. Details and troubleshooting in [KUBERNETES.md](docs/KUBERNETES.md).

### Terraform — AWS (not deployed)

> **AWS deployment was not performed because no active AWS account/credentials were available.** The Terraform configuration was prepared for AWS deployment and validated locally: `terraform fmt`, `init -backend=false`, and `validate` all pass. `terraform plan` fails cleanly at the AWS credential check. **`terraform apply` has never been run and no AWS resource has ever existed.**

```bash
cd terraform
terraform fmt -recursive && terraform init -backend=false && terraform validate
```

Designed: VPC across 2 AZs, public/private subnets, NAT gateways, chained security groups, ALB with path-based routing, ECS Fargate services, RDS PostgreSQL, ECR, Secrets Manager, IAM least privilege, autoscaling. See [TERRAFORM.md](docs/TERRAFORM.md).

### Ansible — host provisioning

```bash
cd ansible
ansible-playbook playbooks/site.yml --check --diff    # dry run
ansible-playbook playbooks/site.yml
```

Installs Docker + Compose plugin, a dedicated service account, UFW default-deny, node_exporter, and security-only unattended upgrades. Idempotency verified (second run: `changed=0`). See [ANSIBLE.md](docs/ANSIBLE.md).

### CI/CD

| Workflow | Purpose |
|---|---|
| `ci.yml` | Lint, typecheck, tests (real Postgres), builds, compose integration + Trivy |
| `docker-publish.yml` | Build both images, push to GHCR with immutable `sha-` tags |
| `k8s-validate.yml` | kubeconform + server-side dry-run on an ephemeral `kind` cluster |

See [CI_CD.md](docs/CI_CD.md).

---

## Project Structure

```text
FoodBridge/
├── src/                         # React frontend
│   ├── api/
│   ├── components/
│   ├── context/
│   ├── hooks/
│   ├── pages/
│   └── ...
│
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── config/
│   │   └── ...
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── scripts/
│       ├── create-admin.ts
│       └── backup/
│
├── k8s/                         # Kubernetes manifests (Minikube-tested)
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── secret.example.yaml      # placeholders only; secret.yaml is gitignored
│   ├── postgres.yaml            # local testing only
│   ├── backend-deployment.yaml
│   ├── frontend-deployment.yaml
│   ├── ingress.yaml
│   └── hpa.yaml
│
├── terraform/                   # AWS target architecture (validated, NOT applied)
│   ├── main.tf  variables.tf  outputs.tf  providers.tf  versions.tf
│   ├── terraform.tfvars.example
│   └── modules/
│       ├── networking/          # VPC, subnets, IGW, NAT, route tables
│       ├── security/            # security groups (ALB / ECS / RDS)
│       ├── database/            # RDS Postgres + Secrets Manager
│       └── compute/             # ECR, ALB, ECS Fargate, IAM, autoscaling
│
├── ansible/                     # Linux host provisioning
│   ├── ansible.cfg
│   ├── inventory/
│   ├── playbooks/site.yml
│   └── roles/                   # app_user, docker, firewall,
│                                #   node_exporter, unattended_upgrades
│
├── monitoring/
│   └── grafana/                 # provisioned datasource + dashboard (in git)
│
├── docs/                        # DevOps documentation (see index above)
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── docker-publish.yml
│       └── k8s-validate.yml
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── Dockerfile
├── nginx.conf
├── prometheus.yml
├── Makefile
├── .env.example
├── .env.production.example
└── README.md
```

---

# Getting Started

## Prerequisites

Install the following before running the project:

* Node.js 20+
* npm
* Docker and Docker Compose
* PostgreSQL, or use the provided Docker development database

Optional, only for the corresponding DevOps sections:

* `minikube` and `kubectl` — for the Kubernetes deployment
* `terraform` — for validating the AWS configuration (no AWS account needed)
* `ansible` — for the host-provisioning playbook
* `trivy` — for local image scanning (`make scan`)

---

## Installation

Clone the repository:

```bash
git clone <repository-url>
cd FoodBridge
```

Install frontend dependencies:

```bash
npm install
```

Install backend dependencies:

```bash
cd backend
npm install
cd ..
```

---

## Environment Configuration

Create the frontend environment file:

```bash
cp .env.example .env
```

Create the backend environment configuration according to the variables required by the application.

At minimum, the backend requires:

```env
DATABASE_URL=postgresql://...
JWT_SECRET=your-secure-secret
NODE_ENV=development
```

For production deployments, use:

```bash
cp .env.production.example .env.production
```

Never commit real credentials or production environment files to source control.

---

# Running the Application

## Development

Start the development infrastructure:

```bash
docker compose up -d
```

Then start the backend and frontend using their respective npm scripts.

The development frontend and backend configuration is defined by the repository's Docker and environment configuration.

---

## Database

FoodBridge uses Prisma for database access and migrations.

Generate Prisma Client:

```bash
cd backend
npx prisma generate
```

Apply development migrations:

```bash
npx prisma migrate dev
```

For production deployments, use:

```bash
npx prisma migrate deploy
```

---

## Seed Development Data

The development seed script creates sample users and application data for local development.

Run:

```bash
cd backend
npm run db:seed
```

The seed process is protected against accidental execution in production.

---

# API Overview

The backend API is served under:

```text
/api
```

Authentication:

```text
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/profile
PUT    /api/auth/profile
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
```

Donations:

```text
GET    /api/donations
GET    /api/donations/stats
GET    /api/donations/my-donations
GET    /api/donations/my-claims
GET    /api/donations/:id
POST   /api/donations
POST   /api/donations/:id/cancel
POST   /api/donations/:id/claim
POST   /api/donations/:id/release
```

Pickups:

```text
GET    /api/pickups/available
GET    /api/pickups/my-pickups
GET    /api/pickups/:id
POST   /api/pickups/:id/accept
POST   /api/pickups/:id/pickup
POST   /api/pickups/:id/complete
```

Users:

```text
GET    /api/users
GET    /api/users/stats
GET    /api/users/pending
GET    /api/users/:id
```

Notifications:

```text
GET    /api/notifications
GET    /api/notifications/unread-count
POST   /api/notifications/:id/read
POST   /api/notifications/read-all
```

Administration:

```text
GET    /api/admin/analytics
GET    /api/admin/activity
POST   /api/users/:id/approve
POST   /api/users/:id/reject
POST   /api/users/:id/suspend
POST   /api/users/:id/activate
POST   /api/pickups/:id/assign
```

> Protected endpoints require appropriate authentication and role/relationship authorization. The server is the source of truth for authorization and state transitions.

---

# Testing

FoodBridge has automated backend and frontend test suites.

Current verified test coverage:

```text
Backend:   483 / 483 tests passing   (33 files)
Frontend:  157 / 157 tests passing   (17 files)
```

Backend tests run against a **real PostgreSQL database**, not mocks — for a Prisma
application, mocked database tests pass while real migrations break. See
[TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for the one-time test-database setup
if `npm test` reports `DATABASE_URL is not set`.

Run backend tests:

```bash
cd backend
npm test
```

Run backend TypeScript validation:

```bash
npx tsc --noEmit
```

Build the backend:

```bash
npm run build
```

Run frontend tests:

```bash
npm test
```

Run frontend TypeScript validation:

```bash
npx tsc --noEmit
```

Run frontend lint:

```bash
npm run lint
```

Build the frontend:

```bash
npm run build
```

CI runs the frontend and backend test suites together with TypeScript validation, linting, and builds.

---

# Production Deployment

Production deployment uses:

```text
Internet
   │
   ▼
Nginx
   │
   ├── /              → React SPA
   │
   ├── /api/*         → Backend
   │
   └── /health       → Backend health check
                         │
                         ▼
                     PostgreSQL
```

Only Nginx is exposed publicly in the production Docker topology.

The backend container:

* Is not directly published to the host
* Runs as a non-root user
* Uses a read-only root filesystem
* Drops Linux capabilities
* Enables `no-new-privileges`
* Has resource limits
* Includes a Docker health check

Production deployment is defined in:

```text
docker-compose.prod.yml
```

Build and start the production stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

---

# Health Checks

Nginx health:

```text
GET /nginx-health
```

Backend health:

```text
GET /health
```

The backend health endpoint verifies database connectivity and returns an unhealthy response when the application cannot reach PostgreSQL.

---

# Backup & Disaster Recovery

FoodBridge includes PostgreSQL backup and restoration tooling.

Create a backup:

```bash
npm run backup:create
```

Verify a backup:

```bash
npm run backup:verify
```

Restore a backup:

```bash
npm run backup:restore
```

The backup tooling uses PostgreSQL's custom dump format and includes safeguards against accidental restoration into the source database.

A disaster-recovery drill has been performed against isolated databases, including:

* Backup creation
* Backup verification
* Full database restoration
* Row-count verification
* Foreign-key integrity verification
* Backend startup against the restored database
* Health-check verification
* Authentication verification

For production, off-site backup storage, encryption, scheduling, retention monitoring, and alerting should be provided by the deployment environment or operational infrastructure.

---

# Security

FoodBridge follows a defense-in-depth security model.

### Authentication

* Signed JWT authentication
* Database-backed user validation on authenticated requests
* Configurable 24-hour token expiry
* Password-change invalidation
* Suspension/rejection invalidation
* Secure password reset tokens

### Authorization

Authorization is enforced server-side.

The application validates:

* User role
* Approval state
* Active state
* Resource ownership
* Donation claimant relationship
* Pickup assignment relationship

### Input Validation

Mutation and query inputs are validated before reaching Prisma.

The application avoids directly spreading untrusted request bodies into database operations.

### Concurrency

Race-sensitive operations use conditional database updates and transactions.

This prevents issues such as:

* Multiple NGOs claiming the same donation
* Multiple volunteers accepting the same pickup
* Invalid state transitions
* Duplicate delivery creation

### Network Security

Production uses:

* Nginx reverse proxy
* Explicit CORS configuration
* Security headers
* Backend network isolation
* Forwarded-header handling
* Request rate limiting

### Container Security

Production containers use:

* Non-root users
* Read-only root filesystems
* Dropped Linux capabilities
* `no-new-privileges`
* Resource limits
* Health checks

---

# Password Recovery

Password recovery follows a secure token-based workflow.

```text
Forgot Password
      │
      ▼
Generate random token
      │
      ▼
Hash token
      │
      ▼
Send reset email
      │
      ▼
Store hashed token
      │
      ▼
User resets password
      │
      ▼
Invalidate token
      │
      ▼
Invalidate previous sessions
```

Reset tokens are:

* Randomly generated
* Stored only as hashes
* Time-limited
* Single-use
* Invalidated after successful password reset

The email layer supports SMTP through Nodemailer while keeping the application independent from a specific email provider.

---

# Operational Considerations

The application code and production container architecture are designed for deployment, but several operational components depend on the hosting environment:

* Domain and DNS configuration
* TLS certificates
* Production SMTP provider
* Off-site scheduled database backups
* Backup monitoring
* Alerting and paging
* Managed PostgreSQL infrastructure

These should be configured before handling real production traffic.

---

# Development Scripts

Useful backend commands include:

```bash
npm test
npm run build
npm run db:seed
npm run admin:create
npm run backup:create
npm run backup:verify
npm run backup:restore
```

Frontend commands include:

```bash
npm test
npm run lint
npm run build
```

---

---

## Disclaimer

FoodBridge is a software platform for coordinating food donation and rescue operations. Real-world deployment requires appropriate operational procedures, data-protection practices, infrastructure configuration, and compliance with applicable laws and organizational requirements.
