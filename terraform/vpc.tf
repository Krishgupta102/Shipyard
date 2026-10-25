# =============================================================================
# VPC Network Topology — Shipyard
#
# ADR-010: AWS Cloud Infrastructure Design
# Provisions an isolated Virtual Private Cloud (VPC) with an Internet Gateway
# and a public subnet for the single-host Shipyard platform.
# =============================================================================

resource "aws_vpc" "shipyard" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "shipyard" {
  vpc_id = aws_vpc.shipyard.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.shipyard.id
  cidr_block              = var.public_subnet_cidr
  availability_zone       = local.az
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-subnet"
    Type = "Public"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.shipyard.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.shipyard.id
  }

  tags = {
    Name = "${local.name_prefix}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}
