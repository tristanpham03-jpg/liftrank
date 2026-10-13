import { z } from "zod";
import { MAX_RANKED_REPS, toKg } from "./scoring";
import type { RankingMethod, WeightUnit } from "./types";

// Mirrors public.is_reserved_username (parity-tested against the migration).
export const RESERVED_USERNAMES = [
  "admin", "administrator", "liftrank", "settings", "support", "help", "api", "auth",
  "login", "logout", "signin", "signup", "onboarding", "home", "profile", "groups", "group",
  "friends", "notifications", "leaderboard", "leaderboards", "lift", "lifts", "invite",
  "me", "root", "system", "moderator", "mod", "staff", "official", "null", "undefined",
  "about", "terms", "privacy", "security", "deleted_user", "anonymous",
] as const;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Use 3–20 lowercase letters, numbers or underscores.")
  .refine((u) => !(RESERVED_USERNAMES as readonly string[]).includes(u), "That username is reserved. Try another.");

export const displayNameSchema = z.string().trim().max(40, "Keep it under 40 characters.").optional();

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");
export const passwordSchema = z.string().min(8, "Use at least 8 characters.").max(72, "Use 72 characters or fewer.");

export const signUpSchema = z.object({ email: emailSchema, password: passwordSchema });
export const signInSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.") });

export type LiftRules = {
  ranking_method: RankingMethod;
  max_weight_kg: number | null;
};

const visibility = z.enum(["private", "groups", "friends", "public"]);

/**
 * Lift input, validated identically in the browser and in the server action.
 * The database repeats every check in submit_lift.
 */
export function liftSchema(rules: LiftRules, now: () => Date = () => new Date()) {
  const bodyweight = rules.ranking_method === "max_reps";
  return z
    .object({
      exerciseId: z.string().uuid("Pick an exercise."),
      weight: z.number().nullable(),
      unit: z.enum(["lb", "kg"]),
      reps: z
        .number({ message: "Enter your reps." })
        .int("Reps must be a whole number.")
        .min(1, "Enter at least 1 rep.")
        .max(bodyweight ? 200 : 50, bodyweight ? "Enter 200 reps or fewer." : "Enter 50 reps or fewer."),
      performedAt: z.string().datetime({ offset: true }).nullable(),
      visibility,
      groupIds: z.array(z.string().uuid()).max(50),
      notes: z.string().trim().max(280, "Keep notes under 280 characters.").nullable(),
      idempotencyKey: z.string().uuid(),
      machineManufacturerId: z.string().uuid().nullable().optional(),
      machineModelId: z.string().uuid().nullable().optional(),
    })
    .superRefine((v, ctx) => {
      if (bodyweight) {
        if (v.weight != null) ctx.addIssue({ code: "custom", path: ["weight"], message: "This exercise is ranked by reps." });
      } else if (v.weight == null || !Number.isFinite(v.weight) || v.weight <= 0) {
        ctx.addIssue({ code: "custom", path: ["weight"], message: "Enter a weight above 0." });
      } else if (Math.round(v.weight * 100) / 100 !== v.weight) {
        ctx.addIssue({ code: "custom", path: ["weight"], message: "Use at most two decimals." });
      } else if (rules.max_weight_kg != null && toKg(v.weight, v.unit as WeightUnit) > rules.max_weight_kg) {
        ctx.addIssue({ code: "custom", path: ["weight"], message: "That's above the maximum for this exercise. Check the weight and unit." });
      }
      if (v.performedAt && new Date(v.performedAt).getTime() > now().getTime() + 5 * 60_000) {
        ctx.addIssue({ code: "custom", path: ["performedAt"], message: "The date can't be in the future." });
      }
      if (v.visibility === "groups" && v.groupIds.length === 0) {
        ctx.addIssue({ code: "custom", path: ["groupIds"], message: "Pick at least one group to share with." });
      }
    });
}

export type LiftInput = z.infer<ReturnType<typeof liftSchema>>;

/** True when a weighted lift will be saved but not ranked (more than 12 reps). */
export function isUnrankedRepCount(method: RankingMethod, reps: number) {
  return (method === "e1rm" || method === "added_load_e1rm") && reps > MAX_RANKED_REPS;
}

export const groupSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(50, "Keep it under 50 characters."),
  description: z.string().trim().max(280, "Keep it under 280 characters.").optional(),
});

export const profileSchema = z.object({
  displayName: z.string().trim().max(40, "Keep it under 40 characters."),
  bio: z.string().trim().max(160, "Keep it under 160 characters."),
  preferredUnit: z.enum(["lb", "kg"]),
  profileVisibility: z.enum(["public", "friends", "private"]),
});

/** Collect the first message per field from a Zod error. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export const gymSchema = z.object({
  name: z.string().trim().min(2, "Gym names need at least 2 characters.").max(100, "Keep the name under 100 characters."),
  address: z.string().trim().max(200, "Keep the address under 200 characters.").optional(),
  city: z.string().trim().min(1, "Enter the city.").max(100, "Keep the city under 100 characters."),
  region: z.string().trim().max(100, "Keep the state or region under 100 characters.").optional(),
  country: z.string().trim().min(2, "Enter the country.").max(100, "Keep the country under 100 characters."),
});
