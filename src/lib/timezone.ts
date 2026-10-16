import "server-only";
import { cookies } from "next/headers";
import { TZ_COOKIE, validTimeZone } from "./dates";

/** The viewer's time zone (from the `tz` cookie), or the app's. */
export async function getTimeZone(): Promise<string> {
  return validTimeZone((await cookies()).get(TZ_COOKIE)?.value);
}
