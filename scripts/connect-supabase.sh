#!/usr/bin/env bash
# Connects this folder to your Supabase project and verifies it, step by step.
#   bash scripts/connect-supabase.sh
# Safe to re-run: every step checks what's already done. It never resets or
# drops anything; `supabase db push` only applies migrations the project hasn't
# seen yet, and asks before doing so. Results are also saved to .connect-supabase.log.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=.connect-supabase.log
: > "$LOG"
# Non-interactive steps are mirrored into $LOG. Interactive ones (login, password,
# confirmations) talk to the terminal directly, since piping them breaks their prompts.
logged() { "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }
note() { echo "$*" | tee -a "$LOG"; }

step() { printf "\n\033[1;32m▶ %s\033[0m\n" "$1"; echo "== $1" >> "$LOG"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$1"; echo "STATUS: FAILED at: $1" >> "$LOG"; exit 1; }
ask() { local a; read -r -p "$1 [y/N] " a </dev/tty; [[ "$a" =~ ^[Yy] ]]; }

step "1/7 Checking Node.js"
if ! command -v node >/dev/null; then
  fail "Node.js isn't installed. Install the LTS version from https://nodejs.org (or: brew install node), open a new Terminal window, and run this script again."
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
logged node -v
[ "$NODE_MAJOR" -ge 20 ] || fail "Node $(node -v) is too old. Install Node 22 LTS from https://nodejs.org and re-run."

step "2/7 Checking .env.local (values are not printed)"
[ -f .env.local ] || fail ".env.local is missing. Copy .env.example to .env.local and fill in your keys."
REF=$(node -e '
  const fs=require("fs"); const env=Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n")
    .filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["\x27]|["\x27]$/g,"")]}));
  const u=env.NEXT_PUBLIC_SUPABASE_URL||""; const m=u.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
  const ok=m&&/^(sb_publishable_|eyJ)/.test(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"")&&/^(sb_secret_|eyJ)/.test(env.SUPABASE_SECRET_KEY||"");
  process.stdout.write(ok?m[1]:"");')
[ -n "$REF" ] || fail ".env.local doesn't have a valid project URL, publishable key and secret key."
note "Project ref: $REF"

step "3/7 Installing dependencies (npm install)"
logged npm install --no-audit --no-fund || fail "npm install"

step "4/7 Linking the Supabase CLI to project $REF"
if [ -f supabase/.temp/project-ref ] && [ "$(cat supabase/.temp/project-ref)" = "$REF" ]; then
  note "Already linked."
else
  if npx supabase projects list >/dev/null 2>&1; then
    note "Already logged in to Supabase."
  else
    echo "Logging in to Supabase: press Enter when asked, finish in the browser, then come back here."
    npx supabase login || fail "supabase login"
  fi
  echo
  echo "Now enter your DATABASE password (the one you set when creating the project). Typing is invisible; that's normal."
  echo "Forgot it? Supabase → Project Settings → Database → Reset database password. That only changes the password; no data is touched."
  npx supabase link --project-ref "$REF" || fail "supabase link"
  note "Linked."
fi

step "5/7 Applying database migrations"
note "Migrations in your project (Remote) vs. this folder (Local):"
logged npx supabase migration list || fail "supabase migration list (if it asks for a password, run: npx supabase link --project-ref $REF)"
echo
note "Preview of what would be applied (nothing changes yet):"
DRY=$(npx supabase db push --dry-run 2>&1) || { echo "$DRY" | tee -a "$LOG"; fail "supabase db push --dry-run"; }
echo "$DRY" | tee -a "$LOG"
if echo "$DRY" | grep -q "up to date"; then
  note "All migrations are already applied. Nothing to do."
elif ask "Apply any pending migrations to your Supabase project? (Adds tables and functions; deletes nothing.)"; then
  npx supabase db push || fail "supabase db push"
  note "After push:"
  logged npx supabase migration list || fail "supabase migration list"
else
  note "Skipped applying migrations."
fi

step "6/7 Verifying against your real database"
logged npm run verify:supabase || fail "live verification (see the ✗ lines above)"
logged npm run typecheck || fail "typecheck"
logged npm test || fail "unit tests"

step "7/7 Optional: browser tests against your project"
echo "These sign up real test users through the UI. Turn OFF 'Confirm email' first:"
echo "  Supabase → Authentication → Sign In / Providers → Email → Confirm email = off"
if ask "Run the Playwright browser tests now? (downloads Chromium the first time; test accounts are deleted afterwards)"; then
  bash scripts/e2e-supabase.sh || fail "Playwright tests (details in .e2e-supabase.log)"
fi

echo "STATUS: ALL STEPS PASSED" >> "$LOG"
printf "\n\033[1;32m✓ LiftRank is connected.\033[0m Start it with:  npm run dev   then open http://localhost:3000\n"
