# FoodBridge — Terraform (AWS target architecture)

**Status: validated locally, never applied. No AWS account exists for this project.**
See `../docs/TERRAFORM.md` for the full write-up. This file is a quick command reference.

## Structure

```
terraform/
├── providers.tf              # AWS provider config
├── versions.tf                # Terraform/provider version constraints
├── main.tf                    # Wires the 4 modules together
├── variables.tf                # Root input variables
├── outputs.tf                  # Root outputs (ALB DNS, ECR URLs, etc.)
├── terraform.tfvars.example    # Copy to terraform.tfvars before any real use
└── modules/
    ├── networking/   # VPC, public/private subnets, IGW, NAT, route tables
    ├── security/     # Security groups (ALB / ECS tasks / RDS)
    ├── database/     # RDS Postgres + Secrets Manager DATABASE_URL
    └── compute/      # ECR, ECS Fargate cluster/services, ALB, autoscaling, IAM
```

## Commands actually run against this configuration

```
terraform fmt -recursive      # formatting - safe, no AWS access
terraform init -backend=false # downloads providers - no AWS access
terraform validate            # syntax + internal consistency - no AWS access
```

All three pass. `terraform plan` was also run once, with no/invalid AWS
credentials, to confirm the failure mode: it plans the two credential-free
`random_password` resources, then fails cleanly with an STS
`InvalidClientTokenId` error before creating anything. **`terraform apply`
has never been run and must not be**, per this project's constraints.

## Before ever applying this for real

1. Add an S3 + DynamoDB remote backend block to `versions.tf` (local state
   is fine for validation, not for a real team/account).
2. `cp terraform.tfvars.example terraform.tfvars` and review every value.
3. Configure real AWS credentials (`aws configure` / SSO / CI OIDC role) -
   never hardcode them here.
4. Build and push real images to the ECR repos this creates (via
   `.github/workflows/docker-publish.yml`, retargeted at ECR) before
   pointing the ECS task definitions at anything other than the
   `:latest` placeholder tag.
5. `terraform plan`, review every resource, then `terraform apply`.
