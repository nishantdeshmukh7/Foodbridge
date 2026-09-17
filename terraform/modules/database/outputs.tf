output "endpoint" {
  value = aws_db_instance.main.address
}

output "database_url_secret_arn" {
  description = "Secrets Manager ARN holding the full DATABASE_URL - referenced by modules/compute's ECS task definition."
  value       = aws_secretsmanager_secret.db_credentials.arn
}
