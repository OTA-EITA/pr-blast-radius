# Example only: used by the demo pull request in this repository.
data "aws_iam_policy_document" "ci" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["arn:aws:s3:::app-artifacts/*"]
  }
}
