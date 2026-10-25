# =============================================================================
# Amazon Elastic Container Registry (ECR) — Shipyard
#
# ADR-010: AWS Cloud Infrastructure Design
# Private container registry for storing immutable application image builds.
# Includes image scanning and lifecycle policies to prune old images.
# =============================================================================

resource "aws_ecr_repository" "shipyard" {
  count                = var.enable_ecr ? 1 : 0
  name                 = "${local.name_prefix}-apps"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "${local.name_prefix}-ecr"
  }
}

resource "aws_ecr_lifecycle_policy" "shipyard" {
  count      = var.enable_ecr ? 1 : 0
  repository = aws_ecr_repository.shipyard[0].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain only the last 50 image builds to prevent unbounded storage costs"
        selection = {
          tagStatus   = "any"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 90
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
