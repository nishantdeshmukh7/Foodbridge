# Managed RDS Postgres, in private subnets only, no public accessibility.
# This is deliberately what docker-compose.prod.yml's own header comment
# already says a real production deployment should use instead of a
# containerized Postgres ("a real production Postgres should be a
# managed/external service...point DATABASE_URL at it") - this module is
# that managed service, for the AWS target architecture.

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "${var.project_name}-db-subnet-group"
  }
}

# Generated, not user-supplied, and never printed in any `terraform plan`
# output a person would casually read (marked sensitive below) - stored in
# Secrets Manager (below) as the single source of truth, exactly the
# pattern docs/SECURITY.md recommends over a Kubernetes Secret's weaker
# base64-only-at-rest-by-default protection.
resource "random_password" "db_master" {
  length  = 32
  special = false # avoid characters that need URL-encoding in DATABASE_URL
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = "15"

  instance_class         = var.instance_class
  allocated_storage      = var.allocated_storage_gb
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = var.db_name
  username               = var.db_username
  password               = random_password.db_master.result
  port                   = 5432
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.security_group_id]

  multi_az            = var.multi_az
  publicly_accessible = false

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:30-mon:05:30"

  # A real deployment should set this true. false here only so
  # `terraform plan`/`validate` (this project's only actual use of this
  # config - see docs/TERRAFORM.md) never risks representing a
  # not-easily-destroyable resource; flip to true before ever applying
  # this against a real account, and take a final snapshot before any
  # intentional teardown.
  deletion_protection = false
  skip_final_snapshot = true

  tags = {
    Name = "${var.project_name}-db"
  }
}

# The Postgres master password, plus a ready-to-use DATABASE_URL, stored in
# Secrets Manager - this is what the ECS task definition (modules/compute)
# reads at container-start time via `secrets:`, rather than the password
# ever appearing in a task definition, a CloudFormation/Terraform state
# diff a person reads casually, or a CI log.
resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "${var.project_name}/database-url"
  description = "Full DATABASE_URL connection string for the FoodBridge backend."
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id     = aws_secretsmanager_secret.db_credentials.id
  secret_string = "postgresql://${var.db_username}:${random_password.db_master.result}@${aws_db_instance.main.address}:5432/${var.db_name}?schema=public"
}
