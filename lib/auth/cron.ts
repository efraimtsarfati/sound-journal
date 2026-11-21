import { safeEqual } from "./crypto";

export const MIN_CRON_SECRET_LENGTH = 16;

/** Fails closed: an unset, empty or short secret never authorizes anything. */
export function isCronAuthorized(
  secret: string | undefined,
  authorization: string | null | undefined,
): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) return false;
  return safeEqual(`Bearer ${secret}`, authorization ?? "");
}
