# SBL community features — future plan (not built)

SBLift is made for the SBL community. This is a plan only; none of it is implemented, and nothing here should be read as a promise of dates.

## Principles
- Training stays private by default. Nothing a lifter logs reaches anyone else unless they submit it.
- Community features sit beside training, never inside the session logger.
- No engagement tricks: no streak shaming, no infinite feeds, no notification spam.
- Moderation is in place before anything user-generated is public (the existing report/moderation tools are the base).

## Candidates (rough order)
1. **Feedback inbox.** A "Send feedback" form in Settings, stored in a private table only moderators can read. Lowest risk; useful immediately.
2. **Announcements.** Short posts from the SBLift team (release notes, catalog additions) in a dismissible card on Home. One table, moderator-only writes, read-tracked per user.
3. **Exercise suggestions.** Users propose an exercise (name, equipment, short description, optional reference link). It goes to the moderation queue and is never added automatically; approved ones ship in a reviewed catalog migration, as now.
4. **Voting.** Upvote suggestions (one vote per user, no downvotes, counts shown only after voting) so the most-wanted exercises and features rise. Needs a rate limit and the same block/visibility rules as the rest of the app.
5. **Creator engagement.** Verified creator accounts (badge set by moderators) that can post announcements or programme templates; templates import as a normal split the user then owns and edits. No paid features planned.

## Data and privacy notes
- Every new table: RLS on, owner/moderator policies, writes through SECURITY DEFINER RPCs with `set search_path = ''` and `auth.uid()`, added to the explicit grant list.
- Suggestions and votes are public only in aggregate; who voted is never shown.
- Account deletion removes feedback, suggestions and votes (or anonymises them where moderation history must stay).

## Open questions
- Who moderates (existing moderator role, or a separate community role)?
- Whether creators need a separate profile type or just a badge.
