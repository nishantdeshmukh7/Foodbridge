# Single ALB, single public entry point - same topology principle as
# docker-compose.prod.yml/nginx.conf (one front door; the backend is never
# directly internet-reachable, only reachable from the frontend target
# group's own traffic path... except in this AWS topology the ALB itself
# routes /api/* directly to the backend target group rather than the
# frontend container proxying it - see the listener rule below for why.

resource "aws_lb" "main" {
  name               = "${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_security_group_id]
  subnets            = var.public_subnet_ids

  tags = {
    Name = "${var.project_name}-alb"
  }
}

resource "aws_lb_target_group" "frontend" {
  name        = "${var.project_name}-frontend-tg"
  port        = var.frontend_container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # required for Fargate (no static EC2 instance to register)

  health_check {
    path                = "/nginx-health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_target_group" "backend" {
  name        = "${var.project_name}-backend-tg"
  port        = var.backend_container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    matcher             = "200"
  }
}

# HTTP listener. If var.acm_certificate_arn is set, this becomes a
# redirect-to-HTTPS listener instead of serving traffic directly (see the
# conditional default_action below) - same "redirect on 80, terminate TLS
# on 443" pattern nginx.conf documents (but not enables by default) for its
# own optional HTTPS block.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = var.acm_certificate_arn != null ? "redirect" : "forward"

    dynamic "redirect" {
      for_each = var.acm_certificate_arn != null ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    target_group_arn = var.acm_certificate_arn != null ? null : aws_lb_target_group.frontend.arn
  }
}

resource "aws_lb_listener" "https" {
  count             = var.acm_certificate_arn != null ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# Routes /api/* and /health straight to the backend target group, bypassing
# the frontend container's own nginx proxy entirely - the more idiomatic
# AWS-native pattern (ALB does the routing a reverse proxy would otherwise
# do) versus the single-nginx-does-everything pattern used for the simpler
# Docker Compose/Kubernetes deployments. This does NOT require any nginx.conf
# change: nginx never sees these paths in this topology, so its own /api
# proxy rule is simply unused here, not conflicting with this rule.
resource "aws_lb_listener_rule" "api_to_backend" {
  listener_arn = var.acm_certificate_arn != null ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    path_pattern {
      values = ["/api/*", "/health"]
    }
  }
}
