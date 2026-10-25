# =============================================================================
# IAM Roles & Least-Privilege Instance Profile — Shipyard
#
# ADR-010: AWS Cloud Infrastructure Design
# Attaches AmazonSSMManagedInstanceCore for keyless, secure shell access via
# AWS Systems Manager, plus scoped CloudWatch and ECR permissions.
# =============================================================================

# ── EC2 Assume Role Policy ───────────────────────────────────────────────────

data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "shipyard_ec2" {
  name               = "${local.name_prefix}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
  description        = "IAM role for Shipyard host EC2 instance."

  tags = {
    Name = "${local.name_prefix}-ec2-role"
  }
}

# ── SSM Managed Policy Attachment ────────────────────────────────────────────
# Allows connecting via `aws ssm start-session` without opening port 22 or managing SSH keys.

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.shipyard_ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# ── CloudWatch Logging Policy ────────────────────────────────────────────────

data "aws_iam_policy_document" "cloudwatch_logs" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

resource "aws_iam_policy" "cloudwatch_logs" {
  name        = "${local.name_prefix}-cloudwatch-policy"
  description = "Allows Shipyard EC2 instance to ship container and system logs to CloudWatch."
  policy      = data.aws_iam_policy_document.cloudwatch_logs.json
}

resource "aws_iam_role_policy_attachment" "cloudwatch_logs" {
  role       = aws_iam_role.shipyard_ec2.name
  policy_arn = aws_iam_policy.cloudwatch_logs.arn
}

# ── ECR Policy (Optional) ────────────────────────────────────────────────────

data "aws_iam_policy_document" "ecr_access" {
  count = var.enable_ecr ? 1 : 0

  statement {
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:GetRepositoryPolicy",
      "ecr:DescribeRepositories",
      "ecr:ListImages",
      "ecr:DescribeImages",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "ecr_access" {
  count       = var.enable_ecr ? 1 : 0
  name        = "${local.name_prefix}-ecr-policy"
  description = "Allows Shipyard build worker to authenticate and push/pull from ECR."
  policy      = data.aws_iam_policy_document.ecr_access[0].json
}

resource "aws_iam_role_policy_attachment" "ecr_access" {
  count      = var.enable_ecr ? 1 : 0
  role       = aws_iam_role.shipyard_ec2.name
  policy_arn = aws_iam_policy.ecr_access[0].arn
}

# ── Instance Profile ─────────────────────────────────────────────────────────

resource "aws_iam_instance_profile" "shipyard_ec2" {
  name = "${local.name_prefix}-instance-profile"
  role = aws_iam_role.shipyard_ec2.name

  tags = {
    Name = "${local.name_prefix}-instance-profile"
  }
}
