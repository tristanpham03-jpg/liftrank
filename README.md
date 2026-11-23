# SBLift

**Every lift is a leaderboard.** Log your best lifts in seconds and see where you rank against your friends and private groups.

**Live:** https://liftrank-roan.vercel.app · **Status:** private beta with a small group of friends.

## Features

- Log a lift in a few taps and get a score that makes different lifters comparable
- Leaderboards for friends and private groups, with group invite links
- Automatic personal-record detection on every submitted lift
- Proof videos that friends can verify
- My Training: a private, spreadsheet-style tracker; you choose which sets go to the boards
- Activity feed and notifications when a friend passes you

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind 4 · Supabase (Postgres, Auth, RLS) · Vercel.

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill it in, see SUPABASE_SETUP.md
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push           # creates the schema in your hosted project
npm run dev                    # http://localhost:3000
```

Node 20.9 or newer. No Docker required. **[SUPABASE_SETUP.md](SUPABASE_SETUP.md)** walks through creating the free project, auth settings, email, and deploying.

## Environment variables

| Name | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client + server | Publishable key (`sb_publishable_…`); the legacy anon key also works (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SECRET_KEY` | **server only** | Secret key (`sb_secret_…`), used to delete a user's own account and by the daily cron |
| `NEXT_PUBLIC_SITE_URL` | client + server | Base URL for email and invite links, and printed on share cards |
| `CRON_SECRET` | **server only** | Guards `/api/cron/daily` (Vercel Cron sends it); see SUPABASE_SETUP.md §7 |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | client + server | `true` to show Google sign-in |

`NEXT_PUBLIC_*` values are inlined at build time.

## Database

- **Migrations:** `supabase/migrations/` (six files: foundation, tables, security, lifts and boards, social, exercise catalog). Apply with `npx supabase db push`, or paste `supabase/combined.sql` (`npm run db:combined`) into the SQL editor.
- **Security model:** RLS is on for every table. Clients read the catalog, their own settings and favorites, and lifts directly (RLS decides visibility). Every write and every social read goes through `SECURITY DEFINER` Postgres functions that check `auth.uid()` and visibility themselves. Clients can't insert notifications, activities, achievements, records, or group memberships.
- **Core function:** `submit_lift` validates, dedupes, scores, inserts, updates group champions, and writes notifications and activities in one transaction. It returns everything the result screen needs.
- **Catalog:** edit `scripts/catalog.py` and run `npm run catalog` to regenerate the catalog migration. Once a migration has been pushed, add changes in a new migration instead of editing the old one.
- **Storage:** not used yet. Video proof is Phase 5.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm test` | Unit tests (scoring, units, rival text, search, validation) |
| `npm run test:db` | Database tests (RLS, `submit_lift`, boards, invites, champions…) against a disposable Postgres in `TEST_DATABASE_URL` |
| `npm run test:e2e` | Playwright flows (needs a running app, see SUPABASE_SETUP.md §6) |
| `npm run test:e2e:local` | Playwright flows fully locally: local Postgres + a test-only Supabase stand-in, no Docker |
| `npm run db:push` | `supabase db push` |

### Database and local E2E tests

Both need a plain local Postgres 15+ (`brew install postgresql@16 && brew services start postgresql@16`), never your Supabase project:

```bash
TEST_DATABASE_URL=postgres://$USER@localhost:5432/postgres npm run test:db
npx playwright install chromium
STANDIN_ADMIN_URL=postgres://$USER@localhost:5432/postgres npm run test:e2e:local
```

`tests/db/shim.sql` recreates the bits of Supabase the schema needs (`auth.users`, `auth.uid()`, roles). `tests/e2e/standin/` is a small test-only server that speaks the subset of Supabase's HTTP API the app uses. It runs every request inside Postgres with the same roles and JWT claims as Supabase, so RLS is exercised for real.

## Project layout

```
src/
  app/
    page.tsx                 landing
    (auth)/                  login, signup, password reset (+ server actions)
    auth/confirm, signout    email-link / OAuth landing, sign-out
    onboarding/              username → first lift → invite friends
    invite/[token]/          group invite landing (works signed out)
    (app)/                   signed-in app: home, leaderboards, lift/new, lifts,
                             groups, friends, notifications, u/[username], settings
  components/                ui primitives, nav, lifts, boards, feed
  lib/                       scoring, rival text, search, validation, data access, Supabase clients
  proxy.ts                   session refresh + route guard (Next 16's middleware)
supabase/migrations/         schema, RLS, functions, catalog
tests/db/                    database tests + Supabase shim
tests/e2e/                   Playwright flows + local stand-in
```

## Deploying

Import the repo in Vercel, add the environment variables, and deploy. Then set Supabase's Site URL and Redirect URLs to your domain. Details are in SUPABASE_SETUP.md §7.

See also: [PLAN.md](PLAN.md) (decisions), [PROGRESS.md](PROGRESS.md) (status), [ROADMAP.md](ROADMAP.md).
