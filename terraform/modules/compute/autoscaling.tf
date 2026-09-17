# Mirrors k8s/hpa.yaml's own choice: only the backend autoscales (CPU-bound
# work - bcrypt hashing, JSON handling, DB queries), the frontend stays at
# its fixed desired_count since static-file-serving/proxying never
# approaches its resource limits under normal load.

resource "aws_appautoscaling_target" "backend" {
  max_capacity       = var.backend_max_count
  min_capacity       = var.backend_desired_count
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${var.project_name}-backend-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  service_namespace  = aws_appautoscaling_target.backend.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    # Same 70% target as k8s/hpa.yaml, same scale-down caution (300s here
    # vs HPA's 120s - ECS tasks take longer to cold-start than a pod
    # scheduling onto an already-running node, so a longer cooldown avoids
    # thrashing).
    target_value       = 70
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
