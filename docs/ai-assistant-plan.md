# LiftRank AI assistant — plan (not implemented)

A premium assistant that answers questions about your own training ("What should I improve in my split?", "What's plateaued?", "Am I training some muscles disproportionately?").

## Architecture
- **Server only.** A Next.js route handler / server action calls the OpenAI API with a key stored as a Vercel env var (`OPENAI_API_KEY`), never sent to the browser.
- **Data access through the user's session.** The handler builds context with the signed-in user's Supabase client (RLS), so it can only read that user's training sets, sessions, splits and their own lifts — never friends' private data. No secret-key reads.
- **Compact context, not raw tables.** Pre-compute summaries in SQL/TS (per-exercise best estimated 1RM by week, set counts per muscle tag from `EXERCISE_MUSCLES`, session frequency, the active split) and send those (a few KB), not every set. The model is asked to cite only these numbers; the existing rule-based tips stay the source of factual claims.
- **Tools instead of free text where possible.** Expose functions (e.g. `get_exercise_trend(slug)`, `get_split()`, `get_weekly_volume()`) so the model fetches only what a question needs.
- **No writes.** The assistant suggests; it never edits routines, sets or boards. Any change is a normal user action.

## Privacy
- Opt-in, with a clear note that summaries of your training are sent to OpenAI for the answer.
- Don't send usernames, emails, notes or friends' data; pseudonymous IDs only. Use API settings that don't train on inputs.
- Store conversations only if the user wants history; owner-only RLS, deletable with the account.

## Cost and limits
- Small model by default for most questions; a larger model only for "analyse my split" style requests.
- Per-user limits in a `ai_usage` table (messages per day / tokens per month), checked server-side before each call; cache identical summary contexts for a few minutes.
- Premium flag on the profile (set by the billing provider's webhook); free users get a few questions per month.
- Log token usage per request to monitor spend; hard monthly budget cap with a friendly "limit reached" message.

## Phasing
1. Read-only Q&A over pre-computed summaries (premium beta).
2. Tool calls for drill-downs.
3. Optional saved conversations.
