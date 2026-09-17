# Terraform — AWS target architecture

## Status: designed and validated, never applied

**AWS deployment has not been performed.** There is no AWS account and no credentials behind this configuration. What follows was written as a real, complete, internally-consistent infrastructure definition and validated as far as is possible without an account — but nothing has ever been created in AWS, and no claim of AWS deployment experience should be read into it.

What was actually run:

```
$ terraform fmt -recursive     # applied formatting fixes
$ terraform init -backend=false
Terraform has been successfully initialized!

$ terraform validate
Success! The configuration is valid.
```

`terraform plan` was also run once, deliberately, to confirm the failure mode is clean:

```
Plan: 2 to add, 0 to change, 0 to destroy.
╷
│ Error: Retrieving AWS account details: validating provider credentials:
│ retrieving caller identity from STS: ... api error InvalidClientTokenId:
│ The security token included in the request is invalid.
╵
```

It plans the two credential-free `random_password` resources, then stops at the first call requiring real AWS access. **`terraform apply` has never been run.**

## What would be created

```
                         Internet
                            │
                            ▼
                  Internet Gateway
                            │
   ┌────────────────── VPC 10.0.0.0/16 ───────────────────────┐
   │                                                            │
   │  Public subnets  10.0.0.0/24, 10.0.1.0/24   (2 AZs)        │
   │    ├── Application Load Balancer                            │
   │    └── NAT Gateway ×2 (one per AZ)                          │
   │                            │                                │
   │                            ▼  (egress only)                 │
   │  Private subnets 10.0.2.0/24, 10.0.3.0/24   (2 AZs)        │
   │    ├── ECS Fargate: frontend tasks (nginx, :8080)           │
   │    ├── ECS Fargate: backend tasks  (node,  :3001)           │
   │    └── RDS PostgreSQL 15 (encrypted, not publicly           │
   │          accessible, 7-day backups)                         │
   └────────────────────────────────────────────────────────────┘

   Supporting: ECR ×2 (immutable tags, scan-on-push, keep-last-10)
               Secrets Manager ×2 (DATABASE_URL, JWT_SECRET)
               CloudWatch Logs ×2 (14-day retention)
               IAM: execution role + task role
               Application Auto Scaling: backend 2→5 @ 70% CPU
```

## Why each component exists

**VPC + two AZs.** Two Availability Zones is the practical minimum: an ALB requires subnets in at least two, and it's what makes RDS Multi-AZ possible later. One AZ would be cheaper and strictly worse.

**Public vs private subnets.** This is the core security boundary. Only the ALB and NAT Gateways sit in public subnets. Every compute and data resource sits in private subnets with `assign_public_ip = false` — they have no route from the internet at all. Outbound access (pulling images from ECR, reaching Secrets Manager) goes through NAT.

**NAT Gateway, one per AZ.** Private subnets need outbound internet for ECR image pulls. One NAT per AZ means a single AZ failure doesn't kill egress for everything. This is also **the single largest recurring cost in the design** — see Cost below.

**ALB.** Single public entry point, TLS termination point (when an ACM cert is supplied), and the health-check authority. Routes `/api/*` and `/health` to the backend target group and everything else to the frontend target group. Target groups use `target_type = "ip"`, which Fargate requires — there's no persistent EC2 instance to register.

**ECS Fargate over EKS or EC2.** Deliberate choice:
- *vs EC2 + ASG*: no AMIs to bake, no patching, no SSH, no bastion. The app is already containerized — Fargate runs the existing images directly.
- *vs EKS*: EKS adds a control-plane cost and substantial operational complexity for a two-service application. The Kubernetes work in this repo is demonstrated properly on Minikube (see [KUBERNETES.md](KUBERNETES.md)) rather than by paying for a managed control plane to run the same two Deployments.

**RDS PostgreSQL.** `storage_encrypted = true`, `publicly_accessible = false`, 7-day automated backups, in private subnets, reachable only from the ECS tasks' security group. This is exactly what `docker-compose.prod.yml`'s own header comment already argues for ("a real production Postgres should be a managed/external service… point `DATABASE_URL` at it") — this module *is* that managed service.

**ECR with `IMMUTABLE` tags.** An immutable tag can't be overwritten, so a deployed task definition always refers to exactly the bytes that were tested. `scan_on_push` adds vulnerability scanning at the registry, complementing the Trivy scan already in CI. A lifecycle policy keeps the last 10 images — unbounded ECR storage is an easy-to-forget recurring cost.

**Secrets Manager.** Both the DB password and `JWT_SECRET` are generated *inside* Terraform (`random_password`) and stored here. They never appear in a `.tfvars` file, shell history, or CI log. ECS injects them at container start via the task definition's `secrets:` block, so they never appear in the task definition either.

**Two IAM roles, separated on purpose.**
- *Execution role* — used by the ECS agent before your code runs: pull from ECR, write to CloudWatch Logs, read the two named secrets. The secrets grant is scoped to those exact ARNs, never `secretsmanager:GetSecretValue` on `*`.
- *Task role* — used by the application code itself. **Intentionally has no policies attached**, because this app makes no AWS API calls (no S3, no SES, nothing). Granting it permissions "just in case" would violate least privilege.

**Security groups — three, chained.**

```
Internet ──80/443──▶ [ALB SG] ──8080/3001──▶ [ECS tasks SG] ──5432──▶ [RDS SG]
```

Only the ALB's SG allows `0.0.0.0/0`. The ECS SG accepts traffic only from the ALB's SG; the RDS SG accepts 5432 only from the ECS SG. Referencing security groups by ID rather than CIDR means the rules stay correct as IPs change.

**`TRUST_PROXY = 2` in this topology** (vs 1 for Compose/Kubernetes) — the ALB plus Fargate's `awsvpc` networking are two hops. The value must match the real hop count exactly; this is the same contract enforced in `backend/src/config/index.ts`.

## Variables

Defined in `terraform/variables.tf`; `terraform.tfvars.example` is the template. None of them are secrets — secrets are generated in-config, never passed in.

| Variable | Default | Purpose |
|---|---|---|
| `aws_region` | `ap-south-1` | Target region |
| `environment` | `production` | Naming/tagging |
| `project_name` | `foodbridge` | Prefix for every resource name |
| `vpc_cidr` | `10.0.0.0/16` | VPC address space |
| `az_count` | `2` | AZs to span |
| `backend_container_port` | `3001` | Matches `backend/Dockerfile` |
| `frontend_container_port` | `8080` | Matches root `Dockerfile` (non-root nginx) |
| `backend_cpu` / `backend_memory` | `256` / `512` | Fargate task sizing |
| `frontend_cpu` / `frontend_memory` | `256` / `512` | Fargate task sizing |
| `backend_desired_count` / `backend_max_count` | `2` / `5` | Autoscaling bounds |
| `db_instance_class` | `db.t4g.micro` | Free-tier-eligible |
| `db_multi_az` | `false` | Off to keep reference cost low; **turn on for real production** |
| `domain_name` / `acm_certificate_arn` | `null` | Supply both to get HTTPS + HTTP→HTTPS redirect |

## Outputs

`alb_dns_name` (the URL you'd visit), `ecr_backend_repository_url`, `ecr_frontend_repository_url`, `ecs_cluster_name`, `database_endpoint`, `vpc_id`.

## Security considerations

**Done in the config:**
- No compute or data resource is publicly reachable; only the ALB is.
- RDS storage encrypted at rest; not publicly accessible.
- Secrets generated in-config and stored in Secrets Manager, never in files or logs.
- IAM least privilege, including an intentionally empty task role.
- Security groups chained by SG reference, no broad CIDRs except the ALB's public listener.
- ECR immutable tags + scan-on-push.
- HTTPS available via ACM with a 1.2/1.3-only TLS policy and automatic HTTP→HTTPS redirect.

**Deliberately not done, and why:**
- **`deletion_protection = false` and `skip_final_snapshot = true` on RDS.** Correct for a config that is only ever validated, wrong for production. **Flip both before any real apply.** Called out here rather than left as a silent trap.
- **No remote state backend.** Local state is fine for validation; a real account needs S3 + DynamoDB for shared, lockable state. State contains every generated secret in plaintext, which is also why `*.tfstate` is gitignored at two levels.
- **`:latest` image tags in the task definitions.** A placeholder so `validate`/`plan` can type-check. A real deploy must pass an immutable, CI-built tag — which `IMMUTABLE` ECR tags structurally enforce.
- **No WAF, GuardDuty, Config, or CloudTrail.** Real controls in a real account, but adding resources that were never applied or tested would be padding.

## Cost awareness

Not free, and worth being explicit about. The dominant line items are the **two NAT Gateways** (an hourly charge each, plus data processing) and the **ALB** (hourly plus LCU). Fargate and `db.t4g.micro` are comparatively small at this scale.

To reduce cost for a portfolio-scale deployment: set `az_count = 1` and use a single NAT Gateway (accepting the AZ-failure risk), or replace NAT with VPC endpoints for ECR/Secrets Manager/CloudWatch if egress is only ever to AWS services.

## How this would actually be deployed

1. Add an S3 + DynamoDB backend block to `versions.tf`.
2. `cp terraform.tfvars.example terraform.tfvars`, review every value.
3. Set `deletion_protection = true`, `skip_final_snapshot = false`, and consider `db_multi_az = true`.
4. Configure credentials — ideally a CI OIDC role, never long-lived keys.
5. `terraform apply` the networking/security/database/ECR resources first.
6. Build and push real images to the new ECR repos (retarget `.github/workflows/docker-publish.yml` from GHCR to ECR).
7. Update the task definitions to the real immutable image tags, then apply the ECS services.
8. Run `prisma migrate deploy` once against the new RDS instance from a task/bastion with the same `DATABASE_URL`.
9. Point DNS at `alb_dns_name` and attach an ACM certificate.

See also `terraform/README.md` for the command quick-reference.
