export type WeightUnit = "lb" | "kg";
export type LiftVisibility = "private" | "groups" | "friends" | "public";
export type ProfileVisibility = "public" | "friends" | "private";
export type RankingMethod = "e1rm" | "max_reps" | "added_load_e1rm" | "none";
export type WeightConvention = "total" | "per_dumbbell" | "stack" | "plates_total" | "added" | "bodyweight";
export type VerificationStatus = "unverified" | "proof_uploaded" | "under_review" | "verified" | "disputed" | "rejected";
export type GroupRole = "owner" | "admin" | "member";
export type Relationship = "self" | "friends" | "outgoing" | "incoming" | "blocked" | "none";

export type Exercise = {
  id: string;
  name: string;
  slug: string;
  category: "chest" | "back" | "shoulders" | "arms" | "legs" | "core" | "full_body";
  muscle_group: string;
  equipment_type: string;
  ranking_method: RankingMethod;
  weight_convention: WeightConvention;
  max_weight_kg: number | null;
  popular_rank: number;
  /** Machine exercises: lifts can record the manufacturer and model. */
  supports_machine_selection: boolean;
  aliases: string[];
};

/** The weight-bearing part of any lift as returned by the API. */
export type LiftLoad = {
  entered_weight: number | null;
  entered_unit: WeightUnit | null;
  weight_kg: number | null;
  reps: number;
  score?: number | null;
};

export type Lift = LiftLoad & {
  id: string;
  user_id: string;
  exercise_id: string;
  weight_convention: WeightConvention;
  score: number | null;
  is_ranked: boolean;
  performed_at: string;
  created_at: string;
  visibility: LiftVisibility;
  verification_status: VerificationStatus;
  notes: string | null;
};

export type BoardRow = LiftLoad & {
  rank: number;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_path: string | null;
  lift_id: string;
  score: number;
  performed_at: string;
  verification_status: VerificationStatus;
  is_me: boolean;
  /** Machine used, if recorded. Model appears only once approved. */
  machine?: { manufacturer: string; model: string | null; model_id: string | null } | null;
};

export type Champion = LiftLoad & {
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_path?: string | null;
  lift_id?: string | null;
  since?: string | null;
};

export type Board = {
  total: number;
  rows: BoardRow[];
  me: BoardRow | null;
  above: BoardRow | null;
  champion: Champion | null;
  /** Gym and nearby boards only. */
  gym?: Gym | null;
  reason?: "no_gym" | "gym_pending" | "no_location" | null;
  opted_in?: boolean;
  radius_mi?: number | null;
};

export type Gym = {
  id: string;
  name: string;
  address: string | null;
  city: string;
  region: string | null;
  country: string;
  status: "pending" | "approved" | "rejected";
  has_location: boolean;
};

export type MachineOptions = {
  manufacturers: { id: string; name: string }[];
  models: { id: string; manufacturer_id: string; name: string; status: "pending" | "approved" }[];
};

export type BoardPosition = {
  kind: "friends" | "group";
  group_id: string | null;
  group_name: string | null;
  rank: number | null;
  total: number;
};

export type SubmitResult = {
  lift_id: string;
  duplicate: boolean;
  is_pr: boolean;
  is_first: boolean;
  score: number | null;
  is_ranked: boolean;
  previous_best: number | null;
  boards_before: BoardPosition[];
  boards: BoardPosition[];
  passed: { user_id: string; username: string }[];
  champion_of: { group_id: string; group_name: string }[];
  gym_records?: { gym_id: string; gym_name: string }[];
  achievements?: Achievement[];
};

export type LiftDefaults = {
  last: { exercise_id: string; entered_weight: number | null; entered_unit: WeightUnit | null; reps: number } | null;
  last_by_exercise: Record<
    string,
    {
      entered_weight: number | null;
      entered_unit: WeightUnit | null;
      reps: number;
      machine_manufacturer_id?: string | null;
      machine_model_id?: string | null;
    }
  >;
  recent_exercise_ids: string[];
  favorite_exercise_ids: string[];
  preferred_unit: WeightUnit;
  default_visibility: LiftVisibility;
  groups: { id: string; name: string }[];
};

export type UserSettings = {
  default_visibility: LiftVisibility;
  notify_friend_requests: boolean;
  notify_passed: boolean;
  notify_first_place: boolean;
  notify_group_joins: boolean;
  featured_exercise_ids: string[];
};

export type MyProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_path: string | null;
  bio: string | null;
  preferred_unit: WeightUnit;
  profile_visibility: ProfileVisibility;
  public_leaderboard_opt_in: boolean;
  onboarded_at: string | null;
  created_at: string;
  primary_gym: Gym | null;
  is_moderator: boolean;
  settings: UserSettings;
};

export type PersonalRecord = LiftLoad & {
  exercise_id: string;
  exercise_name: string;
  exercise_slug: string;
  ranking_method: RankingMethod;
  lift_id: string;
  score: number;
  performed_at: string;
  verification_status: VerificationStatus;
};

export type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
  created_at: string;
  relationship: Relationship;
  friendship_id: string | null;
  can_see_details: boolean;
  bio: string | null;
  featured_exercise_ids: string[];
  prs: PersonalRecord[];
  friend_count: number;
  /** Name and place only; null when hidden by profile visibility. */
  gym?: { id: string; name: string; city: string; region: string | null; country: string } | null;
  titles?: Title[];
  achievements?: (Achievement & { earned_at: string })[];
};

export type HomeBoard = {
  exercise_id: string;
  exercise_name: string;
  ranking_method: RankingMethod;
  kind: "friends" | "group";
  group_id: string | null;
  group_name: string | null;
  rank: number;
  total: number;
  recent: boolean;
  me: LiftLoad & { lift_id: string; score: number };
  above: (LiftLoad & {
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_path: string | null;
    rank: number;
    score: number;
  }) | null;
};

export type HomeData = {
  boards: HomeBoard[];
  lift_count: number;
  friend_count: number;
  group_count: number;
  unread: number;
};

export type PersonRef = { id: string; username: string; display_name: string | null; avatar_path?: string | null };

export type FeedItem = {
  id: string;
  type: "pr" | "passed" | "first_place" | "joined_group";
  created_at: string;
  actor: PersonRef;
  target: PersonRef | null;
  group: { id: string; name: string } | null;
  exercise: { id: string; name: string; ranking_method: RankingMethod } | null;
  lift: (LiftLoad & { id: string; score: number | null }) | null;
  reactions: Record<string, number>;
  my_reactions: string[];
};

export type NotificationItem = {
  id: string;
  type:
    | "friend_request"
    | "friend_accepted"
    | "passed"
    | "first_place"
    | "group_joined"
    | "proof_requested"
    | "proof_response"
    | "proof_reviewed"
    | "gym_record"
    | "monthly_champion"
    | "achievement";
  /** proof_response: declined | uploaded · proof_reviewed: verified | insufficient | rejected */
  detail?: string | null;
  created_at: string;
  read_at: string | null;
  actor: PersonRef | null;
  group: { id: string; name: string } | null;
  gym?: { id: string; name: string } | null;
  achievement?: Achievement | null;
  exercise: { id: string; name: string; ranking_method: RankingMethod } | null;
  lift: (LiftLoad & { id: string; score: number | null; user_id?: string }) | null;
  friendship_id: string | null;
  friendship_pending: boolean;
};

export type GroupSummary = {
  id: string;
  name: string;
  description: string | null;
  avatar_path: string | null;
  role: GroupRole;
  member_count: number;
  champion_count: number;
};

export type GroupDetail = {
  id: string;
  name: string;
  description: string | null;
  avatar_path: string | null;
  created_at: string;
  my_role: GroupRole;
  members: {
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_path: string | null;
    role: GroupRole;
    joined_at: string;
    hidden: boolean;
  }[];
  champions: (LiftLoad & {
    exercise_id: string;
    exercise_name: string;
    ranking_method: RankingMethod;
    user_id: string | null;
    username: string | null;
    display_name: string | null;
    since: string;
  })[];
  board_exercises: { exercise_id: string; exercise_name: string; lifters: number }[];
  invites: { id: string; created_at: string; expires_at: string; max_uses: number | null; use_count: number }[];
};

export type FriendEntry = {
  friendship_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
  since: string;
};

export type FriendsData = {
  friends: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
  blocked: { user_id: string; username: string; display_name: string | null }[];
};

export type UserSearchResult = PersonRef & { relationship: Relationship };

export type InvitePreview = {
  valid: boolean;
  reason: "not_found" | "revoked" | "expired" | "used_up" | "group_full" | null;
  group_id: string | null;
  group_name: string | null;
  member_count: number | null;
  is_member: boolean;
};

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ProofState = {
  /** The owner sees their own status as stored; others see 'rejected' as 'disputed'. */
  status: VerificationStatus;
  is_owner: boolean;
  /** Owner and moderators only. */
  has_video: boolean;
  can_upload: boolean;
  can_request: boolean;
  challenge:
    | {
        id: string;
        status: "open" | "proof_submitted" | "declined" | "resolved" | "withdrawn";
        reason?: string | null;
        response?: string | null;
        created_at: string;
        /** Set when the viewer is the one who asked. */
        mine?: boolean;
        challenger?: PersonRef;
      }
    | null;
  review: { decision: "verified" | "rejected" | "disputed"; notes: string | null; created_at: string } | null;
  /** Confirmed invalid: off every leaderboard and title, kept in history. */
  invalidated: boolean;
  can_appeal: boolean;
  appeal: { status: "open" | "upheld" | "overturned"; note: string; created_at: string } | null;
  limits: { max_bytes: number; max_seconds: number; mime_types: string[] } | null;
};

export type ProofQueueItem = LiftLoad & {
  lift_id: string;
  user_id: string;
  username: string | null;
  exercise: { name: string; ranking_method: RankingMethod; weight_convention: WeightConvention };
  score: number | null;
  performed_at: string;
  uploaded_at: string | null;
  seconds: number | null;
  bytes: number | null;
  requested: boolean;
  appeal: { note: string; created_at: string } | null;
};

export type Achievement = { id: string; name: string; description: string };

/** A record row as the viewer may see it: the lift only when they can still see it. */
export type RecordEntry = {
  user: PersonRef | null;
  lift: (LiftLoad & { id: string; score: number | null; verification_status: VerificationStatus }) | null;
};

/** A championship someone holds right now (group champion or gym record). */
export type Title = RecordEntry & {
  board_key: string;
  kind: "group" | "gym";
  exercise: { id: string; name: string; slug: string; ranking_method: RankingMethod };
  group: { id: string; name: string } | null;
  gym: { id: string; name: string } | null;
  since: string;
};

export type RecordHistory = {
  reigns: (RecordEntry & { since: string; until: string | null })[];
  monthly: (RecordEntry & { month: string; lifters: number })[];
};
