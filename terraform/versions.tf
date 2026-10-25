# =============================================================================
# Terraform & Provider Version Constraints — Shipyard
#
# ADR-010: AWS Cloud Infrastructure Design
# Pins Terraform CLI >= 1.5.0 (supporting modern features like import blocks
# and check blocks) and AWS Provider >= 5.0.
# =============================================================================

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

  # In a production team setup, remote state would be stored in S3 with DynamoDB locking:
  # backend "s3" {
  #   bucket         = "shipyard-terraform-state"
  #   key            = "platform/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "shipyard-terraform-locks"
  #   encrypt        = true
  # }
}
