# Connecting LiftRank to a free Supabase project

About 10 minutes. No Docker needed.

## 1. Create the project

1. Sign in at [supabase.com](https://supabase.com) and click **New project**.
2. Name it `liftrank`, pick the region closest to you (e.g. West US), and choose the **Free** plan.
3. Set a strong **database password** and save it in your password manager. You need it once, in step 3.
4. Wait for the project to finish provisioning (a minute or two).

## 2. Copy the keys into `.env.local`

In the project, open **Settings → API Keys** (or the **Connect** button at the top).

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key, `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | Secret key, `sb_secret_…` (server-only, used for account deletion) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` for now |

The project ref is the `<ref>` part of the URL.

## 3. Create the database

**Option A: CLI (recommended).** The CLI is already a dev dependency.

```bash
npx supabase login                          # opens a browser for an access token
npx supabase link --project-ref <ref>       # asks for the database password from step 1
npx supabase db push                        # applies supabase/migrations/*
```

Later schema changes go in new files in `supabase/migrations/`, followed by another `npx supabase db push`.

**Option B: SQL editor.** Run `npm run db:combined`, open **SQL Editor** in Supabase, paste the contents of `supabase/combined.sql`, and run it once on the empty project. If you use this route, keep using it: the CLI won't know these migrations were applied.

To check it worked, open **Table Editor**. You should see `exercises` with 50 rows.

## 4. Auth settings

Open **Authentication**:

- **URL Configuration**
  - Site URL: `http://localhost:3000` (change to your production URL when you deploy)
  - Redirect URLs: add `http://localhost:3000/**`, and later `https://<your-domain>/**`
- **Sign In / Providers → Email**
  - For local development and the Playwright tests, turn **Confirm email** off so signup goes straight to onboarding.
  - Before launch, turn it back on and set up custom SMTP (below).

### Before launch: email

Supabase's built-in email sender is heavily rate-limited and meant for testing. For real users, add an SMTP provider under **Authentication → Emails → SMTP Settings** (Resend's free tier works). The confirmation and reset links point at `/auth/confirm`, which accepts both the default `?code=` links and `?token_hash=&type=` links. If people open links in a different browser than the one they signed up in, edit the email templates to use
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
(and `type=recovery&next=/reset-password` for password reset).

### Optional: Google sign-in

Enable **Google** under Sign In / Providers with your Google OAuth client, add `https://<ref>.supabase.co/auth/v1/callback` as an authorized redirect URI in Google Cloud, then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.

## 5. Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000, create an account, pick a username, and log a lift.

## 6. Run the end-to-end tests against your project (optional)

With **Confirm email** off:

```bash
npx playwright install chromium            # first time only
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3210 npm run build
npx next start -p 3210 -H 127.0.0.1 &
E2E_BASE_URL=http://127.0.0.1:3210 npm run test:e2e
```

The tests create real users named like `flowa_xxxxxx@example.com` in your project. Delete them afterwards under **Authentication → Users**, or point the tests at a separate free project.

## 7. Deploy to Vercel (small private beta)

The local folder is already a git repository with a first commit (secrets excluded by `.gitignore`; `.env.local` is never committed).

**a. Private GitHub repository**

1. On github.com: **New repository** → name `liftrank` → **Private** → don't add a README, license or .gitignore.
2. In this folder:

   ```bash
   git remote add origin https://github.com/<you>/liftrank.git
   git push -u origin main
   ```

**b. Vercel project** (Hobby plan is free; Vercel's terms limit it to non-commercial use)

1. vercel.com → **Add New → Project** → import the `liftrank` repository. Framework: Next.js (detected).
2. Before the first deploy, add **Settings → Environment Variables** (Production and Preview):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
   | `SUPABASE_SECRET_KEY` | `sb_secret_…` (server only; account deletion and the daily cron) |
   | `NEXT_PUBLIC_SITE_URL` | your production URL, e.g. `https://liftrank.vercel.app` (printed on share cards and used in emails and invites) |
   | `CRON_SECRET` | a long random string (`openssl rand -hex 32`); Vercel Cron sends it to `/api/cron/daily` |
   | `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | `false` unless Google sign-in is set up |

3. Keep it private until you're ready: **Settings → Deployment Protection** → Vercel Authentication on (covers preview and, if you choose, production deployments).
4. Deploy. `NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.

**c. Supabase settings for the production URL** (Authentication)

- **URL Configuration:** Site URL = your production URL. Redirect URLs: add `https://<your-domain>/**` (keep `http://localhost:3000/**` for development).
- **Sign In / Providers → Email:** turn **Confirm email on** for real users.
- **Emails → SMTP Settings:** add a free SMTP provider (e.g. Resend's free tier). Supabase's built-in sender is heavily rate-limited and meant for testing.
- **Attack Protection:** consider turning on leaked-password protection, and keep the default auth rate limits.

**d. Daily job**

`vercel.json` schedules `/api/cron/daily` once a day (09:17 UTC). It finalizes last month's champions and removes unused proof videos and profile pictures. Check it under Vercel → **Settings → Cron Jobs** after the first deploy. Without `CRON_SECRET` it answers 404 and does nothing.

**e. Moderators**

In the Supabase SQL editor: `update public.profiles set is_moderator = true where username = '<name>';`. Use two moderators if you want appeals to be decided (an appeal goes to someone other than the moderator who rejected the lift). Moderators handle reports, proof videos, appeals, gyms and machine models at `/moderation`. To suspend an account, ban it in **Authentication → Users**.

**f. Smoke test on the deployed site**

Sign up with a real address (confirm the email), log a lift, invite a second account to a group, request proof from a friend, upload a short video, then delete the test account from Settings.

## Free-tier notes

- Free projects pause after about a week without activity. Open the dashboard and click **Restore** to wake one.
- Database size, auth users, and bandwidth limits are generous for an MVP. Check **Settings → Usage**.
- Proof videos (Phase 5) use the private Storage bucket `lift-proofs`, created by migration `…0800`. Free plan: 1 GB storage, 50 MB per file, 5 GB egress a month. LiftRank's limits live in `public.proof_settings` (25 MB / 30 s per video, a 750 MB storage budget, a 3 GB monthly playback budget, daily caps). Change them in the SQL editor, e.g. `update public.proof_settings set max_seconds = 45;`. The bucket's size cap follows `max_bytes` automatically.
- Moderators review proof videos, gyms and machine models at `/moderation`. Make someone a moderator with `update public.profiles set is_moderator = true where username = '<name>';`.
- Profile pictures use the public-read bucket `avatars` (`…1100`): own-folder writes only, images only, 512 KB cap (the app uploads ~20 KB WebP files), at most 3 files per person.
- On Vercel, set `CRON_SECRET` (any long random string) so the daily job in `vercel.json` can run. Locally, `npm run cleanup:proofs -- --delete` sweeps proof videos.
