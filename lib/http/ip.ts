import { ipKeyPart } from "../core/rate-limit";

/**
 * The client IP as Vercel reports it: the first `x-forwarded-for` entry (Vercel sets it itself, so a
 * caller cannot spoof it), else `x-real-ip`. Returns "unknown" when neither is present.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  return ipKeyPart(forwarded || request.headers.get("x-real-ip"));
}
