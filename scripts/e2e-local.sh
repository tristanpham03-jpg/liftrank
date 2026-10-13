#!/usr/bin/env bash
# Runs the Playwright flows fully locally, without Docker or a Supabase project:
# a throwaway Postgres database + the test-only Supabase stand-in + a production build.
#
# Needs: a local Postgres 15+ you can create databases on (e.g. `brew install postgresql@16`).
#   STANDIN_ADMIN_URL=postgres://postgres@localhost:5432/postgres ./scripts/e2e-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${STANDIN_ADMIN_URL:?Set STANDIN_ADMIN_URL to a Postgres admin connection string}"
DB=liftrank_e2e
DB_URL="${STANDIN_ADMIN_URL%/*}/$DB"
PORT=54321

node tests/e2e/standin/setup-db.mjs "$DB"
STANDIN_DATABASE_URL="$DB_URL" STANDIN_PORT=$PORT node tests/e2e/standin/server.mjs > .e2e-standin.log 2>&1 &
STANDIN_PID=$!
trap 'kill $STANDIN_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do grep -q ANON_KEY .e2e-standin.log 2>/dev/null && break; sleep 0.3; done
ANON_KEY=$(grep ANON_KEY .e2e-standin.log | cut -d= -f2)
SERVICE_KEY=$(grep SERVICE_KEY .e2e-standin.log | cut -d= -f2)

export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:$PORT"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY"
export SUPABASE_SECRET_KEY="$SERVICE_KEY"
export NEXT_PUBLIC_SITE_URL="http://127.0.0.1:3210"
export NEXT_DIST_DIR=".next-e2e"
# Lets the gym test promote a moderator directly in this throwaway database.
export E2E_DATABASE_URL="$DB_URL"

npx next build
npx playwright test "$@"
