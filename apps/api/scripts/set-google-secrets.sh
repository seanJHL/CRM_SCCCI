#!/usr/bin/env bash
# Set/update Google OAuth secrets on the production ember-api Worker.
# Values are piped straight into `wrangler secret put`, so they never
# land in shell history or process listings.
#
# Usage: ./scripts/set-google-secrets.sh
# Get credentials from: https://console.cloud.google.com/apis/credentials

set -euo pipefail
cd "$(dirname "$0")/.."

read -rp "Google Client ID: " GOOGLE_CLIENT_ID
read -rsp "Google Client Secret: " GOOGLE_CLIENT_SECRET
echo

echo "$GOOGLE_CLIENT_ID" | npx wrangler secret put GOOGLE_CLIENT_ID --env production
echo "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET --env production

echo
echo "Done. Verify the authorized redirect URI in the Google Cloud Console matches:"
echo "  https://ember-api.sean-1df.workers.dev/api/auth/google/callback"
