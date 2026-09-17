# One repository per image, matching the two Dockerfiles already in this
# repo (root Dockerfile = frontend, backend/Dockerfile = backend). CI's
# docker-publish.yml workflow (.github/workflows/) builds these same two
# images and currently pushes them to GHCR, not ECR - pushing to ECR
# instead/also is a one-line change to that workflow's `env.REGISTRY` once
# this Terraform is ever actually applied and AWS credentials exist in CI.

resource "aws_ecr_repository" "frontend" {
  name                 = "${var.project_name}-frontend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "backend" {
  name                 = "${var.project_name}-backend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name
  policy     = local.ecr_keep_last_10_policy
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy     = local.ecr_keep_last_10_policy
}

locals {
  # Keep only the 10 most recent images per repository - unbounded ECR
  # storage is a real, easy-to-forget recurring cost.
  ecr_keep_last_10_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep only the 10 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
