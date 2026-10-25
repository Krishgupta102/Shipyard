# =============================================================================
# Terraform Outputs — Shipyard
#
# ADR-010: AWS Cloud Infrastructure Design
# Exposes connection parameters, public endpoints, and SSM commands.
# =============================================================================

output "instance_id" {
  description = "The AWS EC2 instance ID for the Shipyard host."
  value       = aws_instance.shipyard_server.id
}

output "elastic_ip" {
  description = "The static public Elastic IPv4 address assigned to the Shipyard server."
  value       = aws_eip.shipyard.public_ip
}

output "public_dns" {
  description = "Public DNS name of the Elastic IP."
  value       = aws_eip.shipyard.public_dns
}

output "vpc_id" {
  description = "The ID of the Shipyard Virtual Private Cloud."
  value       = aws_vpc.shipyard.id
}

output "public_subnet_id" {
  description = "The ID of the public subnet hosting the EC2 instance."
  value       = aws_subnet.public.id
}

output "security_group_id" {
  description = "The ID of the security group protecting the Shipyard host."
  value       = aws_security_group.shipyard_ec2.id
}

output "ecr_repository_url" {
  description = "The URL of the private ECR repository (null if enable_ecr is false)."
  value       = var.enable_ecr ? aws_ecr_repository.shipyard[0].repository_url : null
}

output "ssh_command" {
  description = "Example command to connect to the instance via SSH (if public key was configured)."
  value       = "ssh -i ~/.ssh/id_rsa ubuntu@${aws_eip.shipyard.public_ip}"
}

output "ssm_session_command" {
  description = "Recommended command to open a secure shell session via AWS Systems Manager (keyless)."
  value       = "aws ssm start-session --target ${aws_instance.shipyard_server.id} --region ${var.aws_region}"
}

output "platform_http_url" {
  description = "Direct HTTP access URL using the Elastic IP."
  value       = "http://${aws_eip.shipyard.public_ip}"
}
