# =============================================================================
# Terraform Input Variables — Shipyard
#
# Provides structured, validated inputs for provisioning the single-host AWS
# infrastructure for Shipyard.
# =============================================================================

variable "aws_region" {
  type        = string
  description = "The AWS region where Shipyard infrastructure will be provisioned."
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment name (e.g., production, staging, development)."
  default     = "production"

  validation {
    condition     = contains(["production", "staging", "development"], var.environment)
    error_message = "Environment must be one of: production, staging, development."
  }
}

variable "project_name" {
  type        = string
  description = "Prefix applied to all provisioned AWS resource names and tags."
  default     = "shipyard"
}

# ─── Network Configuration ───────────────────────────────────────────────────

variable "vpc_cidr" {
  type        = string
  description = "IPv4 CIDR block for the dedicated Shipyard VPC."
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  type        = string
  description = "IPv4 CIDR block for the public subnet hosting the EC2 instance."
  default     = "10.0.1.0/24"
}

# ─── Compute (EC2) Configuration ─────────────────────────────────────────────

variable "instance_type" {
  type        = string
  description = "EC2 instance size for the Shipyard server. t3.medium (2 vCPU, 4GB RAM) recommended minimum for Docker builds."
  default     = "t3.medium"
}

variable "ami_id" {
  type        = string
  description = "Custom AMI ID. If null, the latest official Ubuntu 22.04 LTS (Jammy) AMI is looked up automatically."
  default     = null
}

variable "root_volume_size_gb" {
  type        = number
  description = "Size of the gp3 root EBS volume in GB. Sized to accommodate Docker images and build layers."
  default     = 50

  validation {
    condition     = var.root_volume_size_gb >= 30
    error_message = "Root volume must be at least 30 GB to allow sufficient Docker cache storage."
  }
}

variable "root_volume_type" {
  type        = string
  description = "EBS volume type for the EC2 root block device."
  default     = "gp3"
}

# ─── Access & Security Configuration ─────────────────────────────────────────

variable "allowed_ssh_cidr" {
  type        = string
  nullable    = true
  description = "IPv4 CIDR block allowed to connect via SSH (port 22). Set to your admin IP /32 (e.g. \"203.0.113.4/32\"). Leave null (default) to omit the SSH rule entirely and use AWS SSM Session Manager for keyless shell access."
  default     = null
}

variable "ssh_public_key" {
  type        = string
  description = "Optional SSH public key string (e.g. ssh-ed25519 ...). If provided, an EC2 Key Pair will be created."
  default     = null
}

# ─── Domain & TLS Configuration ──────────────────────────────────────────────

variable "domain_name" {
  type        = string
  description = "Base domain name for Shipyard (e.g., shipyard.example.com). Used in Traefik ACME and Host rules."
  default     = "shipyard.example.com"
}

variable "letsencrypt_email" {
  type        = string
  description = "Contact email address for Let's Encrypt automated TLS certificate registration and expiry alerts."
  default     = "admin@example.com"
}

variable "enable_ecr" {
  type        = bool
  description = "Whether to provision an AWS ECR private repository for immutable application image storage."
  default     = true
}

variable "common_tags" {
  type        = map(string)
  description = "Common tags applied to all AWS resources created by this module."
  default = {
    Project   = "Shipyard"
    ManagedBy = "Terraform"
  }
}

variable "skip_credentials_validation" {
  type        = bool
  description = "Skip AWS credentials validation (useful for offline/local testing)."
  default     = false
}

variable "skip_requesting_account_id" {
  type        = bool
  description = "Skip requesting AWS account ID (useful for offline/local testing)."
  default     = false
}
