output "alb_dns_name" {
  description = "Public DNS name of the Application Load Balancer - the URL you would visit once this is actually applied."
  value       = module.compute.alb_dns_name
}

output "ecr_backend_repository_url" {
  value = module.compute.ecr_backend_repository_url
}

output "ecr_frontend_repository_url" {
  value = module.compute.ecr_frontend_repository_url
}

output "ecs_cluster_name" {
  value = module.compute.ecs_cluster_name
}

output "database_endpoint" {
  value = module.database.endpoint
}

output "vpc_id" {
  value = module.networking.vpc_id
}
