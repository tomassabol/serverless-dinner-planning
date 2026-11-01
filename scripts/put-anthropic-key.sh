#!/usr/bin/env bash
# Copies ANTHROPIC_API_KEY from the repo's .env into the Secrets Manager secret the tagger and agents read.
# Run after the first deploy of the data stack and whenever the key rotates.
# Usage: scripts/put-anthropic-key.sh
set -euo pipefail

STAGE="${STAGE:-prod}"
PROFILE="${AWS_PROFILE:-tomassabol}"
REGION="eu-west-1"
ENV_FILE="$(dirname "$0")/../.env"

KEY=$(sed -n 's/^ANTHROPIC_API_KEY=//p' "$ENV_FILE" | tail -1 | tr -d "\"'")
if [[ -z "$KEY" ]]; then
  echo "ANTHROPIC_API_KEY not found in $ENV_FILE" >&2
  exit 1
fi

# Passed on stdin so the key never shows up in the process list.
printf '%s' "$KEY" | aws secretsmanager put-secret-value \
  --secret-id "dinner-${STAGE}/anthropic-api-key" \
  --secret-string file:///dev/stdin \
  --profile "$PROFILE" --region "$REGION" \
  --query VersionId --output text
