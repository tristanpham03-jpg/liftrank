# Working on LiftRank

@AGENTS.md

- Spec: `LIFTRANK_BUILD_PROMPT.md`. Decisions and deviations: `PLAN.md`. Current status: `PROGRESS.md`. Update PROGRESS.md as you work.
- Hosted Supabase only, no Docker. Schema changes go in a new file in `supabase/migrations/`; never edit a migration that has been pushed. Apply with `npx supabase db push`.
- Every new SECURITY DEFINER function: `set search_path = ''`, use `auth.uid()`, never trust a user id argument, and add it to the explicit `grant execute … to authenticated` list (each migration revokes execute from everyone first).
- Lift visibility has one rule, `public._can_view_lift`. Anything that shows a lift (boards, feed, notifications, profiles) must go through it or through RLS on `lifts`.
- Before calling something done: `npm run typecheck && npm run lint && npm test`, plus `npm run test:db` for SQL changes and the Playwright flows for UI flows.
