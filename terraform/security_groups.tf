# =============================================================================
# Security Groups & Traffic Isolation — Shipyard
#
# ADR-003: Single-Owner Security Boundary
# ADR-010: AWS Cloud Infrastructure Design
#
# Rules:
# - INGRESS 80 (HTTP): Open to the internet for Traefik edge routing & ACME HTTP-01 challenge.
# - INGRESS 443 (HTTPS): Open to the internet for Traefik TLS termination.
# - INGRESS 22 (SSH): Restricted to `var.allowed_ssh_cidr` (or via SSM Session Manager).
# - STRICTLY ISOLATED: Ports 3000 (Dashboard), 3001 (API), 3002 (Worker metrics),
#   5432 (PostgreSQL), 6379 (Redis), 8080 (Traefik dashboard), 9090 (Prometheus),
#   and 3100 (Grafana) are NEVER exposed to the public internet. They only bind
#   to 127.0.0.1 on the host and communicate over Docker platform networks.
# =============================================================================

resource "aws_security_group" "shipyard_ec2" {
  name        = "${local.name_prefix}-ec2-sg"
  description = "Security group for the Shipyard single-host EC2 server."
  vpc_id      = aws_vpc.shipyard.id

  # ── Ingress: HTTP (Port 80) ────────────────────────────────────────────────
  ingress {
    description      = "HTTP traffic for Traefik edge ingress and ACME HTTP-01 TLS challenge"
    from_port        = 80
    to_port          = 80
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  # ── Ingress: HTTPS (Port 443) ──────────────────────────────────────────────
  ingress {
    description      = "HTTPS traffic for Traefik TLS terminated endpoints"
    from_port        = 443
    to_port          = 443
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  # ── Ingress: SSH (Port 22) — optional, disabled by default ─────────────────
  # SSH is omitted when allowed_ssh_cidr is null (the default). Set allowed_ssh_cidr
  # to your admin IP /32 in terraform.tfvars to enable it. Prefer SSM Session Manager.
  dynamic "ingress" {
    for_each = var.allowed_ssh_cidr != null ? [var.allowed_ssh_cidr] : []
    content {
      description = "SSH administrative access (prefer AWS SSM Session Manager where possible)"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  # ── Egress: All outbound traffic ───────────────────────────────────────────
  egress {
    description      = "Allow all outbound traffic for Docker image pulls, git clones, and OS updates"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  tags = {
    Name = "${local.name_prefix}-ec2-sg"
  }
}
