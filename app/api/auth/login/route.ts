import { NextResponse } from "next/server";
import { attemptLogin } from "@/lib/core";
import { getDb } from "@/lib/db";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  createSessionToken,
  safeNext,
} from "@/lib/auth/session";

function back(request: Request, error: string, next: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));
  const secret = process.env.SESSION_SECRET;
  if (!process.env.APP_PASSWORD || !secret) return back(request, "config", next);

  const result = await attemptLogin(getDb(), process.env.APP_PASSWORD, password);
  if (!result.ok) return back(request, result.reason, next);

  const res = NextResponse.redirect(new URL(next, request.url), 303);
  res.cookies.set(SESSION_COOKIE, createSessionToken(secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
