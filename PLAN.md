# SBLift — Implementation Plan (Phases 1–3)

This file records the build order and every decision the original product brief didn't cover or that deliberately departs from it.

## Environment decisions

- **Hosted Supabase, no Docker.** The owner wants a free Supabase Cloud project and no Docker Desktop. Brief §0.4 (local Supabase CLI) is replaced:
  - Migrations live in `supabase/migrations/` and are pushed with `npx supabase link` + `npx supabase db push`. Neither command needs Docker.
  - `supabase/combined.sql` concatenates all migrations for pasting into the dashboard SQL editor as a fallback.
  - **Database tests** run with Vitest + `pg` against any disposable Postgres 15+ (`TEST_DATABASE_URL`). `tests/db/shim.sql` recreates the parts of Supabase the schema depends on (`auth.users`, `auth.uid()`, the `anon`/`authenticated`/`service_role` roles, the `extensions` schema). This replaces pgTAP / `supabase test db`, which need Docker. Never point `TEST_DATABASE_URL` at the cloud project: the tests drop and recreate the database.
  - **Playwright** flows can run two ways: against the cloud project with email confirmation off (see `SUPABASE_SETUP.md`), or fully locally with `npm run test:e2e:local`, which uses a test-only stand-in for the Supabase HTTP API (`tests/e2e/standin/`). The stand-in runs every request inside Postgres as `anon`/`authenticated` with JWT claims, like PostgREST, so RLS and grants are exercised for real. It only implements the calls the app makes; it isn't a substitute for a final run against Supabase.
- **Next.js 16.4 with `cacheComponents: false`.** Nearly every screen depends on the session, so the classic dynamic model is simpler and has fewer failure modes than Cache Components plus Suspense around every cookie read. `proxy.ts` (the Next 16 name for middleware) refreshes the Supabase session.
- **API keys.** Supabase now issues publishable (`sb_publishable_…`) and secret (`sb_secret_…`) keys. The legacy anon/service_role keys also work. The env names are `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
- **shadcn/ui.** The shadcn registry isn't reachable from the build environment, so the handful of primitives are hand-written in shadcn style on top of `radix-ui` + `class-variance-authority` in `src/components/ui`. They can be swapped for registry versions later.

## Departures from the brief, with reasons

| Brief | Decision | Why |
|---|---|---|
| §3.1 exercise search via `pg_trgm` | Search runs on the client over the preloaded catalog (≈60 rows) with the same rules: word-prefix tokens, aliases, typo-tolerant fallback | Instant results with no round-trip per keystroke, which matters for the 5-second goal. Fully unit-tested. Revisit when the catalog grows past a few hundred rows. |
| §3.5 leaderboard functions `SECURITY INVOKER` | Board functions are `SECURITY DEFINER` with explicit composition rules and viewer checks | Hiding a blocked user's row *without renumbering* (also §3.5) is impossible if RLS removes their lifts before ranking. Each board's composition is a strict subset of what RLS allows the viewer to see, and the DB tests assert this. |
| §4 `lifts.added_weight_kg` | Dropped; `weight_kg` holds the added load when `weight_convention = 'added'` | One weight column per lift avoids two sources of truth. |
| §3.11 champions all-time + monthly | `record_history` tracks **all-time** group champions. Monthly #1 is shown live on the board but not historized. | Keeps champion sync simple and correct. Monthly history can be added in Phase 6. |
| §3.7 `APP_TIMEZONE` env | The SQL function `public.app_timezone()` is the single source (default `America/Los_Angeles`) | The month boundary is computed in SQL, so it has to live there. |
| Friends board composition | Viewer + accepted friends, lifts with visibility `public` or `friends` only (including the viewer's own) | Matches the visibility table. A private lift appears only in the owner's history/PRs, so "your rank" is the rank your friends see. |
| Lift edits | Visibility/group changes and deletes go through RPCs (`update_lift_sharing`, `delete_lift`). Notes edit via RPC too. No direct UPDATE grant on `lifts`. | Visibility changes can change group champions, so they need the same sync logic as submits. |
| Group ownership | No `groups.owner_id` column; ownership is the single `group_members.role = 'owner'` row (enforced by a partial unique index) | One source of truth; makes transfer and account deletion clean. |
| Onboarding gym step (§5) | Folded into the username step as a one-line "coming soon" note | A separate placeholder screen would cost a tap and a few seconds of the one-minute budget for nothing. |
| `supabase/seed.sql` dev seed (§0.7) | Not included | With a hosted project there is no throwaway local database to seed, and inserting fake auth users into a real project is risky. Tests create their own users. |
| Invite links | Only the SHA-256 hash is stored, so a link is shown once when created. Admins can create new links and see/revoke active ones. | Required by §3.14. |

## Build order

1. Scaffold, design tokens, UI primitives.
2. Migrations: enums → tables → helpers + RLS → RPCs (`submit_lift`, boards, groups, invites, friends, notifications, feed, home) → catalog seed.
3. DB tests against local Postgres with the Supabase shim.
4. Supabase clients (`@supabase/ssr`), `proxy.ts`, auth pages, onboarding, app shell, landing.
5. Add Lift + result, history, lift detail, leaderboards.
6. Friends, blocks, groups, invites, feed, notifications, profile, settings, account deletion, PWA.
7. Typecheck, lint, unit + DB tests, `next build`. Playwright specs written; run once the cloud project exists.
8. README, ROADMAP, PROGRESS, SUPABASE_SETUP.

## Phase 5 decisions (Oct 11, 2026)

| Topic | Decision | Why |
|---|---|---|
| Who can watch proof | Owner and moderators only | Keeps egress near zero, and nobody has to watch videos to take part. The badge carries the result. |
| Upload path | Browser → Storage directly, into a server-reserved slot enforced by a Storage RLS policy | No secret key in user flows, no server proxying 25 MB bodies, and progress via XHR. |
| Playback | RPC grant (2 min, rate-limited, monthly byte budget) → Storage signs a URL only while the grant is live | Rate limits can't be bypassed by calling Storage directly. |
| Limits | One-row `proof_settings` table, editable without a migration; a trigger keeps the bucket's size cap in sync | "Configurable" without redeploying. |
| `rejected` | Shown to others as "Disputed"; the lift stays on all-lift boards | Never imply cheating; it drops out of verified-only boards. |
| `under_review` | Unused; shown as "Proof uploaded" | One waiting state is simpler. |
| Insufficient evidence | Stored as review `disputed`; the lift becomes `disputed` and its video is deleted; the owner may try again | Saves storage; a clearer video can follow. |
| File deletion | App deletes through the Storage API, plus a daily service-role sweep (`proof_orphans`) | Supabase blocks deletes from SQL (`storage.protect_objects_delete`). |
| Secret key | Now also used by the cleanup cron (`CRON_SECRET`-guarded), never by request-steered code | The sweep must reach files whose owners are gone. |
| Proof notifications | Always on (no settings toggle) | They're replies to an action the person took or must answer. |
| Reports | Not built in Phase 5 | Not in the Phase 5 request; the `reports` table is ready. |

## Proof refinements and Phase 6 decisions (Oct 11–12, 2026)

| Topic | Decision | Why |
|---|---|---|
| Requester playback | The person who asked may watch, through the same 2-minute grant and daily and monthly limits; only once a video was submitted, and only while they can still see the lift | They asked for it; still no open access, and costs stay bounded. |
| Insufficient vs. invalid | Insufficient → "Disputed", still competes. Rejected → `invalidated_at`, "Not accepted", off every board, title, PR and feed item, kept in history | Uncertainty shouldn't punish; a confirmed problem shouldn't win titles. |
| Appeals | Once per lift, note plus a new video, and a different moderator (queue hides it from the rejecter, and the RPC refuses them) | Simple, reuses the upload and review flow, and gives a real second opinion. |
| Achievements | The seeded set, plus Monthly Champion; triggers and `submit_lift` award them, once each | No XP, levels or ratings, per the brief. |
| Gym records | Same rules as group champions (3+ lifters, none on machine exercises' combined board), stored in `record_history` | One history model for every title. |
| Monthly champions | Frozen by the daily cron after the 3-day late-logging window; looks back 3 months | Past months can't be rewritten after that window, so results are final. |
| Cards | Rendered only on tap, `no-store`; the leaderboard card anonymizes other people's non-public lifts | Rendering costs nothing until someone shares; images outlive their audience. |

## Phase 7 decisions (Oct 13, 2026)

| Topic | Decision | Why |
|---|---|---|
| Profile pictures | Public-read bucket, own-folder writes, 512 KB cap, client-side 256 px WebP | Pictures show on every board row; signed URLs per row would cost requests and egress for little privacy gain (unguessable paths, no listing). |
| Reports | RPC-only, visibility-checked, one open per target, 10/day; moderators remove content or dismiss | Simple and enough for a beta. Bans happen in the Supabase dashboard rather than in a custom suspension system. |
| Lift rate limit | Trigger: 60 inserts per hour per user | Stops scripts and loops without touching `submit_lift`. |
| CSP | Not added | Needs nonces and dynamic rendering for every page; the other headers are in place. |
| Deploy | Guide and config only; no deploy without the owner's approval | As instructed. |

## Friend verification (Oct 15, 2026; owner's decision)

| Topic | Decision | Why |
|---|---|---|
| Who verifies | Any friend or groupmate who can see the lift; one confirmation | The owner wants verification to be social. This departs from the brief's moderator-only verification (§9 Phase 5). |
| Rejecting | Nobody can mark a lift invalid; friends can only verify or say "not enough to tell" (Disputed, still counts) | So friends can't knock a rival off a board. |
| Moderators | No video review; they keep reports, gyms and machine models | Owner's choice. Appeals ended with it. |
| Watch first | `verify_proof` requires a playback grant for that video | A confirmation should mean someone actually opened it. |
