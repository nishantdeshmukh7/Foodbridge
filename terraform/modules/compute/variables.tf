variable "project_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "alb_security_group_id" {
  type = string
}

variable "ecs_tasks_security_group_id" {
  type = string
}

variable "database_url_secret_arn" {
  type = string
}

variable "backend_container_port" {
  type = number
}

variable "frontend_container_port" {
  type = number
}

variable "backend_cpu" {
  type = number
}

variable "backend_memory" {
  type = number
}

variable "frontend_cpu" {
  type = number
}

variable "frontend_memory" {
  type = number
}

variable "backend_desired_count" {
  type = number
}

variable "frontend_desired_count" {
  type = number
}

variable "backend_max_count" {
  type = number
}

variable "domain_name" {
  type    = string
  default = null
}

variable "acm_certificate_arn" {
  type    = string
  default = null
}
