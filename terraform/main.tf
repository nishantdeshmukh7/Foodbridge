# Root module: wires the four child modules together into the full AWS
# target architecture described in docs/TERRAFORM.md. See that doc for the
# full topology diagram and the explicit statement that this has been
# validated (fmt/validate) but never applied - there is no AWS account
# behind this configuration.

module "networking" {
  source = "./modules/networking"

  project_name = var.project_name
  vpc_cidr     = var.vpc_cidr
  az_count     = var.az_count
}

module "security" {
  source = "./modules/security"

  project_name            = var.project_name
  vpc_id                  = module.networking.vpc_id
  backend_container_port  = var.backend_container_port
  frontend_container_port = var.frontend_container_port
}

module "database" {
  source = "./modules/database"

  project_name         = var.project_name
  private_subnet_ids   = module.networking.private_subnet_ids
  security_group_id    = module.security.rds_sg_id
  instance_class       = var.db_instance_class
  allocated_storage_gb = var.db_allocated_storage_gb
  db_name              = var.db_name
  db_username          = var.db_username
  multi_az             = var.db_multi_az
}

module "compute" {
  source = "./modules/compute"

  project_name                = var.project_name
  aws_region                  = var.aws_region
  vpc_id                      = module.networking.vpc_id
  public_subnet_ids           = module.networking.public_subnet_ids
  private_subnet_ids          = module.networking.private_subnet_ids
  alb_security_group_id       = module.security.alb_sg_id
  ecs_tasks_security_group_id = module.security.ecs_tasks_sg_id
  database_url_secret_arn     = module.database.database_url_secret_arn

  backend_container_port  = var.backend_container_port
  frontend_container_port = var.frontend_container_port
  backend_cpu             = var.backend_cpu
  backend_memory          = var.backend_memory
  frontend_cpu            = var.frontend_cpu
  frontend_memory         = var.frontend_memory
  backend_desired_count   = var.backend_desired_count
  frontend_desired_count  = var.frontend_desired_count
  backend_max_count       = var.backend_max_count
  domain_name             = var.domain_name
  acm_certificate_arn     = var.acm_certificate_arn
}
