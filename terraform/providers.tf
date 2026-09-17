provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "foodbridge"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}
