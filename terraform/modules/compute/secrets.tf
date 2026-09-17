# JWT_SECRET, generated here rather than accepted as a variable, for the
# same reason the database password is generated in modules/database: it
# should never pass through a `terraform.tfvars` file, shell history, or CI
# log. Must satisfy backend/src/config/index.ts's own validation
# (>= 32 chars, not a known placeholder) - 64 random bytes as hex clears
# both by construction.
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${var.project_name}/jwt-secret"
  description = "JWT signing secret for the FoodBridge backend."
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}
