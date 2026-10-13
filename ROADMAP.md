# LiftRank roadmap

## Done (Phases 1–3)

- Auth: email signup/login, password reset, sign-out, protected routes, account deletion, Google sign-in behind a flag
- One-minute onboarding: username → first lift → invite
- Exercise catalog (50 exercises, aliases) with instant, typo-tolerant search, recent exercises and favorites
- Five-second Add Lift with remembered defaults, weight-convention hints, e1RM preview, visibility and group sharing
- Scoring: Epley e1RM (1–12 reps), reps for bodyweight, added load for weighted bodyweight; total-order tie-breaks
- PR detection, result screen with rank changes, passes and new titles
- Friends and group leaderboards, all time and this month, with a 3-day late-entry cutoff
- Lift visibility (private / selected groups / friends / public) enforced by RLS and re-checked at read time
- Friends, blocks, private groups with roles, hashed expiring invite links that survive signup
- Group champions (3+ lifters) with record history
- Rivals, activity feed with reactions, notifications with settings
- Profiles with PRs, featured lifts, ranking highlights and privacy levels
- PWA manifest, icons, offline protection
- Unit, database and end-to-end test suites

## Not done yet

- Avatar and group image upload (Storage)
- A Playwright run against hosted Supabase
- Custom SMTP and email templates (configuration, not code)

## Phase 4: gyms and machines
- User-submitted gyms, moderator approval, coordinates
- Primary gym in onboarding and settings; gym boards (opt-in)
- Nearby boards (5 / 10 / 25 mi by gym coordinates), percentiles only at 20+ lifters
- Machine manufacturers (seeded) and user-submitted models; exact-model filter; remembered machine per exercise

## Phase 5: verification
- Private video bucket, signed URLs, upload progress and retry, size and duration limits
- Proof challenges (one active per lift, rate-limited, block-aware)
- Moderator review queue; verified-only filter; reports

## Phase 6: gamification
- Achievements (definitions already seeded), titles
- Shareable PR, profile and group cards via OG image generation

## Phase 7: polish
- Accessibility audit, error states, performance (materialized board ranks), service worker, deploy hardening

## Future, not planned
Native app, push notifications, machine QR codes, gym-vs-gym, university leagues, subscriptions, gym-owner dashboards, automated video analysis.
