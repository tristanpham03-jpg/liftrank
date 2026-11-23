# SBLift pre-launch security audit (2026-11-23)

**Scope:** the whole app (Next.js 16 on Vercel), the Supabase database (RLS, SECURITY DEFINER functions, Storage) and personal recordings on R2.

**Method:**
- Every check ran against the real hosted system, with throwaway accounts only (`sec_*`, `secr_*`, `secw_*`, `secv_*`, `secx_*` @example.com), all deleted afterwards.
- The owner's account and data were never modified. The analytics rows the probes themselves created were removed.

**Status of fixes:**
- **Code fixes:** on branch `security-audit`, not deployed.
- **Migration 0024:** written and tested in a rolled-back transaction; **not applied**.

## Summary
| Severity | Found | Fixed in code | Waits for migration 0024 | Recommendation only |
|---|---|---|---|---|
| Critical | 0 | – | – | – |
| High | 0 | – | – | – |
| Medium | 3 | 1 (open redirect) | 2 (login throttling, analytics abuse) | – |
| Low | 6 | 3 (password blocklist, constant-time cron check, session filter hardening) | – | 3 |
| Info | 2 | – | – | 2 |

**No user can read, change or delete another user's data.** That's verified for every table and every user-callable function that takes another user's ids (131/131 probe checks; the owner's footprint byte-identical after all attacks).

## Verified protections (by category)
1. **Admin routes and privilege escalation:**
   - `/moderation` returns 404 to non-moderators (decided in the proxy).
   - `is_moderator` can't be read or written by users (column grants).
   - Every `mod_*`, `verify_proof` and `get_proofs_to_check` call by a non-moderator is refused.
   - 58 maintenance functions are executable by the service role only. Calling them as a user is refused (probe: `finalize_recording`, `recording_maintenance`, `proof_orphans`, `close_monthly_records`, `avatar_orphans`, `_recompute_session_prs`, `_personal_best`).
2. **IDOR:**
   - All 47 tables have RLS. Signed-in users can write directly to only three: `favorite_exercises` and `user_settings` (own rows only), and `analytics_events` (see M3).
   - The probe's user B tried to read 17 kinds of A's rows and update 7 tables directly, and called 27 RPCs with A's ids (splits, days, sets, sessions, recordings, lifts, groups, invites, proofs). Every attempt was refused or had no effect.
   - Private lifts never leak through `get_prs`, `get_profile` or `get_proof_state`. Detail pages answer a real 404 for anything hidden (Phase 2).
3. **Secrets:**
   - No secret value or name appears in any of the 70 client bundles (the only hit is `sb_secret_`, a prefix check inside the Supabase library).
   - Server-only modules are marked `server-only`.
   - The secret key is used in exactly three server paths: deleting the caller's own account, the cron job (secret-guarded), and finalizing the caller's own recording after server checks.
   - `.env*` files aren't tracked; every commit's diff is scanned.
4. **Client-side manipulation:**
   - Quotas, upload sizes and durations, recording readiness, PR flags, scores and lift visibility are all decided in the database or on the server.
   - The browser's numbers are re-checked: real file size, duration and container are read from the stored file.
   - Storage quota holds under concurrent uploads (verified earlier at 250 MB).
5. **Authentication:**
   - Email confirmation is on: a fresh sign-up gets no session.
   - The app requires 8+ characters.
   - Sign-out is POST only.
   - Redirect targets after sign-in are validated (see M1).
6. **XSS:**
   - No `dangerouslySetInnerHTML` or `innerHTML` anywhere. React escapes all text.
   - Links from data are built from ids or slugs, or come from code (technique videos).
   - Browser test: `<img onerror>`, `<script>` and `<svg onload>` in a display name and bio render as text with no execution (Flow V2).
7. **Uploads and recordings:**
   - Private R2 bucket: unsigned GET, PUT and DELETE are refused.
   - Signed URLs are short-lived (upload 15 min for an exact size and type; playback 10 min).
   - Keys are random and issued by the database.
   - The server verifies the real size, container and duration.
   - Proof videos use a private Storage bucket with function-checked policies (25 MB, video types only).
8. **SQL injection:**
   - There's no dynamic SQL (`EXECUTE`/`format`) in any function; all queries are parameterized.
   - The two filter strings built in TypeScript use only database-sourced or verified ids (one was hardened to use the database id instead of the URL's).
9. **RLS:** every exposed table has RLS on.
   - Owner-only tables use `user_id = auth.uid()`; lifts go through `can_view_lift`.
   - Profiles expose only username, display name, avatar and join date to other users.
   - Anonymous (publishable key) access returns nothing for every table except the public exercise catalog.
10. **SECURITY DEFINER functions:**
    - All 157 have `search_path = ""`.
    - Execute is revoked from everyone and re-granted explicitly.
    - Only 2 functions are callable anonymously: the invite previews, which reveal nothing for an unknown token.
    - Functions that take a user id either apply visibility rules (`get_prs`), act only on the caller (`block_user`, `send_friend_request` …) or check admin rights (`am_group_admin`).
11. **Races and replays:**
    - A single-use invite accepted by 3 people at once lets in exactly 1.
    - 4 identical lift submissions at once create 1 lift.
    - 4 identical "finish workout" requests save the sets once, and a replay with another key is refused.
    - 4 identical split imports create 1 split.
    - Concurrent uploads can't overshoot the quota.
12. **CSRF, CORS, headers and sessions:**
    - Server actions accept POST only and are origin-checked by Next (no `allowedOrigins` override).
    - Cookies are SameSite=Lax and Secure.
    - Headers: HSTS (2 years, preload), `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, and a restrictive `Permissions-Policy`.
    - R2 CORS allows only the site and localhost; other origins are refused.
    - Supabase REST is CORS-open by design, protected by RLS.
13. **Rate limits:** 17 database-enforced limits on writes (lifts, sessions, splits, sets, edits, invites, groups, reports, proof requests, uploads, avatar changes …). Supabase limits auth emails. Gaps: M2, M3.
14. **Future AI and payments:** see the recommendations.

## Findings
### M1 (Medium): open redirect after sign-in. FIXED (code)
- **Path:** `safeNext()` (login, Google sign-in, `/auth/confirm`).
- **Problem:** it blocked `//x` and `/\x` but not tabs, newlines or carriage returns, which browsers strip. `/login?next=/%09/evil.example` → after a real sign-in the browser went to `evil.example`. That was **confirmed against the deployed code** in a browser test, and could be used for phishing right after a genuine login.
- **Fix:** `src/lib/safe-next.ts`. Refuses any whitespace, control character or backslash, requires the path to resolve to this origin, and caps the length.
- **Tests:** unit tests, plus browser test Flow V1 (6 crafted values, no request ever reaches the attacker host).

### M2 (Medium): no brute-force protection on sign-in. FIX READY (migration 0024 + code)
- **Problem:** 25 wrong passwords in a row were never limited. Sign-in runs on the server, so Supabase's per-IP limits only ever see the app's own servers.
- **Fix:** `auth_attempts` plus `auth_throttle_check`/`auth_throttle_record` (service role only), and `src/lib/auth-throttle.ts`.
  - **Limits:** 10 failures per email or 30 per IP in 15 minutes; 5 sign-ups per IP per hour.
  - **Storage:** keyed hashes only, no raw emails or IPs.
  - **Failure mode:** fails open if the database is unreachable.
- **Tests:** SQL test `tests/sql/2400_*` (rolled back, passing); browser test Flow V3 (runs once 0024 is applied).

### M3 (Medium): unbounded analytics inserts. FIX READY (migration 0024 + code)
- **Problem:** any signed-in user could insert unlimited events of any size directly; a 200 KB event and 50 rapid inserts were accepted. That allows storage and cost abuse.
- **Fix:** direct insert is revoked. `log_event(name, props)` validates the name, caps props at 2 KB and allows 300 events per user per hour; `track()` uses it (falling back to the old insert until 0024 exists).

### Low
- **L1. Supabase Auth allows 6-character and very common passwords when its API is called directly.** The app already required 8.
  - **Fixed in the app:** a common-password blocklist plus no single-repeated-character passwords.
  - **Recommended:** set Supabase Auth to a minimum of 8 and turn on leaked-password protection.
- **L2. Sign-up reveals that an email has an account** ("That email already has an account"). A UX trade-off.
  - **Recommended:** a neutral message ("check your email"), or accept the risk.
- **L3. The avatars bucket is public.** An avatar URL works for anyone, including avatars of private profiles. Paths aren't guessable without the id.
  - **Recommended:** accept, or move to signed URLs.
- **L4. No Content-Security-Policy.** No XSS sinks were found, but a CSP limits the damage if one appears.
  - **Recommended:** a nonce-based CSP after launch (it needs dynamic rendering of the nonce).
- **L5. The cron secret was compared with `!==`. FIXED:** constant-time comparison.
- **L6. The session page built a filter string from the URL id**; it was effectively validated by an earlier exact lookup. **HARDENED:** it now uses the database id.

### Info
- **I1.** `cancel_recording` returns success for another user's recording id but changes nothing (fingerprint-verified). Could raise `not_found` for consistency.
- **I2.** Supabase session cookies aren't `HttpOnly` (the client library's default). This only matters if an XSS existed; none was found.

## Tests added (reusable before every release)
- **`scripts/security-probe.mjs`:** cross-user, anonymous and privilege-escalation probe; 131 checks; byte-level integrity fingerprint.
- **`scripts/check-import-concurrency.mjs` and `scripts/check-quota-concurrency.mjs`:** race checks.
- **`tests/e2e/flow-v-security.spec.ts`:** V1 open redirect, V2 XSS rendering, V3 login throttling.
- **`tests/sql/2400_security_fixes.test.sql`:** throttle and analytics rules, grants, `search_path`.
- **Unit tests:** `safeNext`, password rules.

## Before launch (recommended order)
1. **Apply migration 0024 and deploy** the `security-audit` branch (M1–M3, L1, L5, L6). Then run Flow V3 and the probe against production.
2. **Supabase Auth settings** (dashboard):
   - minimum password length 8 and leaked-password protection;
   - CAPTCHA (Turnstile or hCaptcha) on sign-up and sign-in;
   - check the email rate limits and the SMTP provider.
3. **Monitoring:** alert on spikes of `auth_attempts` refusals, `storage_full`, and 4xx/5xx rates in Vercel.
4. **Re-run before each release:** `security-probe.mjs` after any migration that adds tables or functions (every new table needs RLS; every new function needs `search_path = ''`, `auth.uid()` and an explicit grant).
5. **Future AI import:**
   - treat screenshots and files as untrusted data, never as instructions;
   - use strict JSON-schema output and the deterministic catalog matcher as the only path to the database;
   - keep the API key server-only, with per-user limits and a spend cap;
   - put no tools or actions in the model's hands, and keep originals private and short-lived.
6. **Future payments:**
   - use a hosted checkout (e.g. Stripe Checkout), never card data on SBLift;
   - entitlements set only by a verified webhook (signature-checked, idempotent by event id) that updates `video_storage_accounts.plan_id` with the service role;
   - never trust a plan from the client.
