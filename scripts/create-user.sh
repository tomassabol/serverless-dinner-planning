#!/usr/bin/env bash
# Creates a household member in the Cognito user pool. Cognito emails a temporary password.
# Usage: scripts/create-user.sh <email> [given-name] [household-id]
set -euo pipefail

EMAIL="${1:?email required}"
GIVEN_NAME="${2:-}"
HOUSEHOLD_ID="${3:-home}"
STAGE="${STAGE:-prod}"
PROFILE="${AWS_PROFILE:-tomassabol}"
REGION="eu-west-1"

USER_POOL_ID=$(aws ssm get-parameter --name "/dinner-${STAGE}/auth/user-pool-id" \
  --query Parameter.Value --output text --profile "$PROFILE" --region "$REGION")

ATTRIBUTES=(
  Name=email,Value="$EMAIL"
  Name=email_verified,Value=true
  Name=custom:householdId,Value="$HOUSEHOLD_ID"
)
if [[ -n "$GIVEN_NAME" ]]; then
  ATTRIBUTES+=(Name=given_name,Value="$GIVEN_NAME")
fi

aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --user-attributes "${ATTRIBUTES[@]}" \
  --desired-delivery-mediums EMAIL \
  --profile "$PROFILE" --region "$REGION" \
  --query 'User.Username' --output text
