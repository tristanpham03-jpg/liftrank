# iOS packaging plan (planning only)

Status: evaluation. No native project, no Apple Developer purchase, no App Store submission yet. The web app (PWA) stays the product; anything native wraps it.

## Option A — Capacitor wrapper (recommended first step)
- Capacitor 7 with `server.url` pointing at the deployed site (remote mode), or a static shell that loads it. SBLift is server-rendered (Next.js on Vercel), so a fully bundled offline build isn't possible without a rewrite; remote mode keeps one codebase.
- What works unchanged: auth (cookies on the app's own domain inside WKWebView), Supabase, session drafts in localStorage, the session logger.
- Needed work: a launch screen and icon set (blocked until the new logo exists), safe-area checks (already handled via `viewport-fit=cover` and `--safe-bottom`), deep links for `/invite/*` and `/f/*` (Universal Links via an `apple-app-site-association` file), and a native share sheet via `@capacitor/share` (the web share API already works in WKWebView).
- Effort: small (days), most of it App Store assets and review prep.

## App Store considerations
- **Guideline 4.2 (minimum functionality):** a thin wrapper around a website can be rejected. Native value to add before submitting: Live Activity for the active session (below), haptics on set entry, and native share. These make the case that it's an app, not a bookmark.
- **Sign in with Apple (4.8):** required only if the app offers third-party sign-in. SBLift uses email/password only, so it isn't required today; adding Google sign-in later would trigger it.
- **Account deletion (5.1.1(v)):** already in Settings — keep it reachable in the app.
- **Privacy labels:** data collected = email, username, training data, optional photos (avatars, proof videos). No tracking, no ads.
- **User-generated content (1.2):** report and block already exist; keep the moderation queue staffed.
- Costs: Apple Developer Program membership (annual). Not purchased; needs your decision.

## Live Activity for the active session (plan)
- Shows on the Lock Screen / Dynamic Island while a session is active: day name, elapsed time, current exercise and set (e.g. "Incline Smith Press · set 2 of 3"), and a rest timer if one is added later.
- Implementation: a small Swift widget extension (ActivityKit) plus a Capacitor plugin bridge. The web app calls the bridge on Start, on each set entry (debounced) and on End/Discard.
- Data stays on the device: the activity is updated locally from the web view, no push server needed at first. Remote updates (ActivityKit push tokens) only if the session should update from another device.
- Ends automatically when the session ends or after 8 hours (ActivityKit limit), matching "the session stays until End or Discard" by simply not showing a stale activity.

## Option B — native rewrite (not recommended now)
SwiftUI client on the same Supabase backend. Best feel, but duplicates every screen and every rule already enforced in SQL. Revisit only if the wrapper hits a hard limit.

## Next steps when ready
1. Approve the Apple Developer membership.
2. Finish the logo/icon set.
3. Add Capacitor in a separate `ios/` folder (no change to the web build), Universal Links file under `public/.well-known/`.
4. Build the Live Activity extension, then submit to TestFlight.
