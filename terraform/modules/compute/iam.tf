# Two distinct roles per ECS Fargate convention, kept deliberately separate
# (least privilege - the same principle the Docker layer already applies
# with `cap_drop: ALL`):
#
#   execution role - used by the ECS agent itself, BEFORE your container
#     code ever runs, to pull the image from ECR and fetch secrets from
#     Secrets Manager to inject as environment variables.
#   task role       - used by your application code AFTER it's running,
#     for any AWS API calls the app itself makes. This app makes none
#     today (no S3, no SES, no other AWS SDK calls anywhere in
#     backend/src) - so its policy is intentionally empty/unattached
#     rather than granted broad permissions "just in case".

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.project_name}-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The managed policy above covers ECR pull + CloudWatch Logs, but NOT
# reading Secrets Manager - that needs an explicit, scoped grant naming
# exactly the one secret this app needs (var.database_url_secret_arn and
# the JWT secret below), never `secretsmanager:GetSecretValue` on `*`.
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.database_url_secret_arn,
      aws_secretsmanager_secret.jwt_secret.arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "${var.project_name}-execution-secrets-access"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${var.project_name}-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  # Deliberately no policies attached - see this file's header comment.
  # Add scoped permissions here only when the application code itself
  # actually needs to call an AWS API (e.g. S3 for file uploads).
}
