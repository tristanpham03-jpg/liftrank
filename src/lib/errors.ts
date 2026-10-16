/** Database error codes raised by RPCs → messages shown to people. */
const MESSAGES: Record<string, string> = {
  not_authenticated: "Sign in to continue.",
  onboarding_required: "Pick a username first.",
  invalid_exercise: "Pick an exercise from the list.",
  invalid_weight: "Enter a weight above 0 with at most two decimals.",
  invalid_unit: "Choose lb or kg.",
  weight_too_high: "That's above the maximum for this exercise. Check the weight and unit.",
  weight_not_allowed: "This exercise is ranked by reps, so leave the weight empty.",
  invalid_reps: "Enter a valid number of reps.",
  future_date: "The date can't be in the future.",
  date_too_old: "Lifts older than five years can't be logged.",
  notes_too_long: "Keep notes under 280 characters.",
  groups_required: "Pick at least one group to share with.",
  not_a_member: "You're not a member of that group.",
  not_found: "That doesn't exist or you can't see it.",
  forbidden: "You don't have permission to do that.",
  username_invalid: "Use 3–20 lowercase letters, numbers or underscores.",
  username_reserved: "That username is reserved. Try another.",
  username_taken: "That username is taken. Try another.",
  display_name_too_long: "Keep your name under 40 characters.",
  bio_too_long: "Keep your bio under 160 characters.",
  group_name_invalid: "Group names need 2–50 characters.",
  description_too_long: "Keep the description under 280 characters.",
  too_many_groups: "You can own up to 20 groups.",
  invite_invalid: "This invite link is invalid, expired or used up. Ask for a new one.",
  group_full: "This group is full (200 members).",
  owner_must_transfer: "Make someone else the owner before leaving, or delete the group.",
  use_leave: "Use Leave group to remove yourself.",
  invalid_user: "That person can't be added.",
  too_many_requests: "You have too many pending requests. Wait for some to be answered.",
  invalid_expiry: "Choose an expiry between 1 and 30 days.",
  invalid_max_uses: "Choose between 1 and 200 uses.",
  too_many_invites: "This group has too many active invite links. Revoke some first.",
  invalid_reaction: "That reaction isn't available.",
  invalid_board: "That leaderboard doesn't exist.",
  invalid_period: "That time period isn't available.",
  invalid_radius: "Choose 5, 10 or 25 miles.",
  machine_not_allowed: "This exercise doesn't use a machine.",
  invalid_machine: "That machine isn't available. Pick another or leave it blank.",
  invalid_manufacturer: "Pick a manufacturer first.",
  invalid_model_name: "Model names need 1–100 characters.",
  model_rejected: "That model name was turned down. Pick another or leave it blank.",
  invalid_gym: "That gym isn't available. Pick another or add it.",
  invalid_gym_name: "Gym names need 2–100 characters.",
  invalid_city: "Enter the city.",
  invalid_country: "Enter the country.",
  invalid_address: "Keep the address under 200 characters.",
  too_many_pending: "You have several submissions waiting for review. Try again once they're checked.",
  location_required: "Add the gym's latitude and longitude to approve it.",
  cannot_request_proof: "You can ask friends for proof of lifts that aren't verified or already waiting for review.",
  proof_already_requested: "Proof was already requested for this lift.",
  too_many_proof_requests: "You've asked for proof a few times today. Try again tomorrow.",
  reason_too_long: "Keep it under 280 characters.",
  proof_not_needed: "This lift already has proof waiting for review or is verified.",
  invalid_video_type: "Pick a video (MP4, MOV or WebM).",
  video_too_large: "That video is over the size limit. Trim it or record at a lower resolution.",
  video_too_long: "That video is over the length limit. Keep just the lift.",
  too_many_uploads: "You've added a few videos today. Try again tomorrow.",
  proof_storage_full: "Proof uploads are paused for now while we make room. Try again later.",
  upload_expired: "That upload took too long. Start it again.",
  upload_missing: "The video didn't finish uploading. Try again.",
  too_many_views: "You've opened a lot of videos today. Try again tomorrow.",
  proof_view_budget: "Video playback is paused for the rest of the month to keep within our limits.",
  invalid_decision: "Pick verified, insufficient evidence or rejected.",
  cannot_review_own: "You can't review your own lift.",
  cannot_appeal: "Only a lift that wasn't accepted can be appealed.",
  already_appealed: "This lift has already been appealed once.",
  appeal_note_invalid: "Say briefly why the decision should change (3–500 characters).",
  appeal_needs_other_reviewer: "A different moderator needs to review this appeal.",
  watch_first: "Watch the video before you decide.",
  too_many_friend_invites: "You've made several invite links today. Share one you already have, or try tomorrow.",
  too_many_edits: "You've edited a lot of lifts in the last hour. Try again later.",
  invalid_date: "Pick a date.",
  invalid_visibility: "Choose who can see this lift.",
  invalid_avatar: "That picture didn't upload. Try again.",
  too_many_avatar_changes: "You've changed your picture a lot today. Try again tomorrow.",
  invalid_report: "Pick what's wrong.",
  already_reported: "You've already reported this. A moderator will look at it.",
  too_many_reports: "You've sent several reports today. Try again tomorrow.",
  too_many_lifts: "That's a lot of lifts in an hour. Take a breather and try again soon.",
};

export const GENERIC_ERROR = "Something went wrong. Try again.";

export function errorCode(error: unknown): string | null {
  const msg = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  const code = msg.trim();
  return code in MESSAGES ? code : null;
}

export function friendlyError(error: unknown): string {
  const code = errorCode(error);
  return code ? MESSAGES[code] : GENERIC_ERROR;
}

export class AppError extends Error {
  constructor(
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}
