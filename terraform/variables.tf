variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Deployment environment name, used in resource naming/tagging."
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Short name prefixed onto every resource this project creates."
  type        = string
  default     = "foodbridge"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to spread public/private subnets across. 2 is the practical minimum for an ALB + RDS Multi-AZ-capable design."
  type        = number
  default     = 2
}

variable "backend_container_port" {
  description = "Port the backend container listens on (matches backend/Dockerfile EXPOSE)."
  type        = number
  default     = 3001
}

variable "frontend_container_port" {
  description = "Port the frontend (nginx) container listens on (matches Dockerfile EXPOSE - non-root nginx cannot bind <1024)."
  type        = number
  default     = 8080
}

variable "backend_cpu" {
  description = "Fargate task CPU units for the backend service (256 = 0.25 vCPU). Sized from the same docker-compose.prod.yml cpus: 0.5 observation this repo already documents - 256 is the Fargate-valid step below that, a reasonable starting point for light production traffic."
  type        = number
  default     = 256
}

variable "backend_memory" {
  description = "Fargate task memory (MiB) for the backend service. Mirrors docker-compose.prod.yml's mem_limit: 256m with headroom for Fargate's fixed CPU/memory pairing constraints."
  type        = number
  default     = 512
}

variable "frontend_cpu" {
  description = "Fargate task CPU units for the frontend service."
  type        = number
  default     = 256
}

variable "frontend_memory" {
  description = "Fargate task memory (MiB) for the frontend service."
  type        = number
  default     = 512
}

variable "backend_desired_count" {
  description = "Baseline number of backend tasks (before autoscaling)."
  type        = number
  default     = 2
}

variable "frontend_desired_count" {
  description = "Baseline number of frontend tasks (before autoscaling)."
  type        = number
  default     = 2
}

variable "backend_max_count" {
  description = "Maximum backend tasks the autoscaling policy may scale to."
  type        = number
  default     = 5
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is Free-Tier-eligible and appropriate for a small/portfolio-scale deployment - size up for real production load."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GB."
  type        = number
  default     = 20
}

variable "db_name" {
  description = "Postgres database name (matches DATABASE_URL's dbname across this repo)."
  type        = string
  default     = "foodbridge"
}

variable "db_username" {
  description = "Postgres master username."
  type        = string
  default     = "foodbridge_admin"
}

variable "db_multi_az" {
  description = "Whether RDS runs Multi-AZ (standby replica in a second AZ for automatic failover). Off by default to keep the reference cost low for a portfolio deployment; turn on for real production availability requirements."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Optional custom domain for the ALB (used only if you also provide an ACM certificate ARN). Leave null to serve over the ALB's default DNS name on HTTP only."
  type        = string
  default     = null
}

variable "acm_certificate_arn" {
  description = "Optional ACM certificate ARN for HTTPS on the ALB listener. Leave null to skip HTTPS (HTTP-only ALB listener)."
  type        = string
  default     = null
}
