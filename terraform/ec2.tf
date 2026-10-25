# =============================================================================
# EC2 Instance & Elastic IP Configuration — Shipyard
#
# ADR-010: AWS Cloud Infrastructure Design
# Provisions the single-host compute instance with gp3 storage, IAM profile,
# automated bootstrap via user_data, and a dedicated Elastic IP.
# =============================================================================

# ── Dynamic AMI Lookup ────────────────────────────────────────────────────────
# Automatically locates the latest official Ubuntu 22.04 LTS AMI from Canonical

data "aws_ami" "ubuntu" {
  count       = var.ami_id == null ? 1 : 0
  most_recent = true
  owners      = ["099720109477"] # Canonical official AWS account ID

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }
}

locals {
  selected_ami_id = var.ami_id != null ? var.ami_id : data.aws_ami.ubuntu[0].id
}

# ── Optional SSH Key Pair ─────────────────────────────────────────────────────

resource "aws_key_pair" "shipyard" {
  count      = var.ssh_public_key != null ? 1 : 0
  key_name   = "${local.name_prefix}-key"
  public_key = var.ssh_public_key

  tags = {
    Name = "${local.name_prefix}-key"
  }
}

# ── EC2 Compute Instance ──────────────────────────────────────────────────────

resource "aws_instance" "shipyard_server" {
  ami                    = local.selected_ami_id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.shipyard_ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.shipyard_ec2.name
  key_name               = var.ssh_public_key != null ? aws_key_pair.shipyard[0].key_name : null

  # Bootstrap script via user_data
  user_data = file("${path.module}/user_data.sh")

  # Storage configuration
  root_block_device {
    volume_size           = var.root_volume_size_gb
    volume_type           = var.root_volume_type
    encrypted             = true
    delete_on_termination = true

    tags = {
      Name = "${local.name_prefix}-root-ebs"
    }
  }

  # Enable detailed monitoring for CloudWatch metrics
  monitoring = true

  tags = {
    Name = "${local.name_prefix}-server"
    Role = "Application-Host"
  }

  lifecycle {
    ignore_changes = [
      # Prevent accidental instance recreations if a newer AMI is released
      ami,
    ]
  }
}

# ── Elastic IP (Static Public IPv4) ───────────────────────────────────────────
# Ensures the public IP remains static across instance stops and starts.

resource "aws_eip" "shipyard" {
  domain   = "vpc"
  instance = aws_instance.shipyard_server.id

  tags = {
    Name = "${local.name_prefix}-eip"
  }

  depends_on = [aws_internet_gateway.shipyard]
}
