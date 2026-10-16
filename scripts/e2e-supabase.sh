#!/usr/bin/env bash
# Runs the Playwright browser flows against your real Supabase project, then
# deletes the test accounts they created. Needs "Confirm email" OFF in Supabase.
#   bash scripts/e2e-supabase.sh
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=.e2e-supabase.log
: > "$LOG"
logged() { "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

echo "▶ Installing the test browser (first time only)"
logged npx playwright install chromium || { echo "STATUS: FAILED playwright install" >> "$LOG"; exit 1; }

echo "▶ Building LiftRank for testing"
NEXT_DIST_DIR=.next-e2e NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3210 logged npx next build || { echo "STATUS: FAILED build" >> "$LOG"; exit 1; }

echo "▶ Starting the test server on port 3210"
LR_NET_DEBUG=1 NEXT_DIST_DIR=.next-e2e npx next start -p 3210 -H 127.0.0.1 > .e2e-server.log 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:3210 && break; sleep 1; done

echo "▶ Running the browser flows"
E2E_BASE_URL=http://127.0.0.1:3210 logged npx playwright test
RESULT=$?

echo "▶ Slow or stalled server requests (from .e2e-server.log)"
grep -E "^\[net\] (STALL|#)" .e2e-server.log | tee -a "$LOG" | tail -40 || true
echo "  ($(grep -c "^\[net\] STALL" .e2e-server.log || true) stalls)" | tee -a "$LOG"

echo "▶ Removing test accounts"
logged node --env-file=.env.local scripts/cleanup-test-users.mjs --delete

if [ $RESULT -eq 0 ]; then echo "STATUS: E2E PASSED" | tee -a "$LOG"; else echo "STATUS: E2E FAILED" | tee -a "$LOG"; fi
exit $RESULT
