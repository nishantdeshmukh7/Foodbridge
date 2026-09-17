# Three security groups, each scoped to exactly the traffic its layer
# needs - mirrors the same "narrowest possible reachability" principle
# already applied at the Docker layer (docker-compose.prod.yml: backend
# has no published host port at all, only nginx does). Here:
#
#   Internet ──80/443──▶ [ALB SG] ──container port──▶ [ECS tasks SG] ──5432──▶ [RDS SG]
#
# Nothing reaches ECS tasks except the ALB; nothing reaches RDS except ECS
# tasks. No security group here allows 0.0.0.0/0 except the ALB's public
# listener ports, by design.

resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-alb-"
  description = "Allows inbound HTTP/HTTPS from the internet to the ALB only."
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS (only meaningful once an ACM certificate is attached to the listener - see modules/compute)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "ALB reaches ECS tasks on their container ports only"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-alb-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "ecs_tasks" {
  name_prefix = "${var.project_name}-ecs-tasks-"
  description = "Allows inbound only from the ALB, on the frontend/backend container ports."
  vpc_id      = var.vpc_id

  ingress {
    description     = "From ALB to frontend container port"
    from_port       = var.frontend_container_port
    to_port         = var.frontend_container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "From ALB to backend container port"
    from_port       = var.backend_container_port
    to_port         = var.backend_container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "ECS tasks reach RDS, ECR, CloudWatch Logs, etc. over HTTPS/Postgres"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-ecs-tasks-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "${var.project_name}-rds-"
  description = "Allows inbound Postgres only from ECS tasks."
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from ECS tasks only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-rds-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}
