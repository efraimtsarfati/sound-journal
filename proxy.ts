import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isPublicPath, verifySessionToken } from "@/lib/auth/session";

/** Everything needs a session except the paths that authenticate themselves. Fails closed if SESSION_SECRET is unset. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (verifySessionToken(process.env.SESSION_SECRET, request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
