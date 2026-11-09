#!/usr/bin/env bash
# Creates a household member in the Cognito user pool. Cognito emails a temporary password.
# Members of one household share a household id (lowercase letters, digits and dashes); a new id is a new
# household with its own plans. Country and location are then set in the web app's Settings tab.
# Usage: scripts/create-user.sh <email> [given-name] [household-id]
set -euo pipefail

EMAIL="${1:?email required}"
GIVEN_NAME="${2:-}"
HOUSEHOLD_ID="${3:-home}"
if [[ ! "$HOUSEHOLD_ID" =~ ^[a-z0-9-]{1,64}$ ]]; then
  echo "Household id must be 1-64 lowercase letters, digits or dashes" >&2
  exit 1
fi
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
