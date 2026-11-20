/**
 * Dates are stored as timestamps and shown in the viewer's time zone. Pages
 * render on the server (UTC on Vercel), so formatting without a time zone
 * showed evening lifts on the next day. The browser stores its zone in the
 * `tz` cookie (TimezoneCookie); until then we use the app's zone, which also
 * defines monthly leaderboards (public.app_timezone()).
 */
export const APP_TIMEZONE = "America/Los_Angeles";
export const TZ_COOKIE = "tz";

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return APP_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return APP_TIMEZONE;
  }
}

export function formatDate(iso: string, tz: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return new Date(iso).toLocaleDateString("en-US", { ...opts, timeZone: validTimeZone(tz) });
}

/**
 * A calendar day ("YYYY-MM-DD") as a short label: "Nov 12" this year,
 * "Jan 3, 2025" otherwise, so an old date never reads as recent.
 */
export function shortDay(ymd: string): string {
  const sameYear = ymd.slice(0, 4) === String(new Date().getFullYear());
  return formatDate(`${ymd}T12:00:00Z`, "UTC", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** "2026-10-15" for an instant, in a time zone (for grouping by day). */
export function dayKey(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: validTimeZone(tz), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today's date on this device ("YYYY-MM-DD"). Browser only. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Noon on a past calendar day in this device's time zone, as an ISO instant. Browser only. */
export function localNoon(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/** Adds whole days to a "YYYY-MM-DD" calendar day. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}
