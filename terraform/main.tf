# =============================================================================
# Provider Configuration & Local Constants — Shipyard
#
# ADR-010: AWS Cloud Infrastructure Design
# Configures the AWS provider with default tags and region.
# =============================================================================

provider "aws" {
  region                      = var.aws_region
  skip_credentials_validation = var.skip_credentials_validation
  skip_requesting_account_id  = var.skip_requesting_account_id

  default_tags {
    tags = merge(
      var.common_tags,
      {
        Environment = var.environment
        Application = "Shipyard-Platform"
      }
    )
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # Availability zone selection: use first AZ if not explicitly provided
  az = "${var.aws_region}a"
}
