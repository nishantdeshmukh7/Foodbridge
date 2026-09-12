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

### Infrastructure

* Docker
* Docker Compose
* Nginx
* GitHub Actions
* Prometheus
* Grafana

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
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── Dockerfile
├── nginx.conf
├── .env.example
├── .env.production.example
└── README.md
```

---

# Getting Started

## Prerequisites

Install the following before running the project:

* Node.js
* npm
* Docker and Docker Compose
* PostgreSQL, or use the provided Docker development database

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
Backend:   477 / 477 tests passing
Frontend:  156 / 156 tests passing
```

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
