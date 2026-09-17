terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # No backend block is configured deliberately. This project has no AWS
  # account (see docs/TERRAFORM.md) and therefore no S3 bucket/DynamoDB
  # table to hold remote state - `terraform init` here uses purely local
  # state, which is correct for validation-only use. Before this is ever
  # applied against a real AWS account, add an S3 + DynamoDB remote backend
  # block here so state is shared and lockable, rather than living on one
  # laptop.
}
