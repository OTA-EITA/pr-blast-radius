# Example only: used by the demo pull request in this repository.
resource "aws_db_instance" "main" {
  identifier          = "app"
  engine              = "postgres"
  instance_class      = "db.t4g.medium"
  allocated_storage   = 50
  storage_encrypted   = true
  deletion_protection = true
  publicly_accessible = false
}

resource "aws_security_group_rule" "db_from_app" {
  type                     = "ingress"
  security_group_id        = aws_db_instance.main.vpc_security_group_ids[0]
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = "sg-app"
}
