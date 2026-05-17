# TFLint configuration for XGate
# https://github.com/terraform-linters/tflint

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# Disable specific rules
# rule "terraform_deprecated_interpolation" {
#   enabled = false
# }

# Enable specific rules
# rule "terraform_unused_declarations" {
#   enabled = true
# }

# Terraform version compatibility
terraform {
  # variant = "0.12"  # For Terraform 0.12 compatibility
}

# Ignore specific files
# ignore_modules = [
#   "./modules/example"
# ]

# Skip files
# skip_files = [
#   "tests/**/*.tf",
#   "examples/**/*.tf"
# ]
