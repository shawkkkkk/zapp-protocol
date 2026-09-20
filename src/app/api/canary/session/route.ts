import { NextRequest, NextResponse } from "next/server";
import {
  CANARY_COOKIE,
  canaryEnabled,
  createCanarySessionToken,
  hasCanarySession,
} from "@/lib/server/mutation-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    enabled: canaryEnabled(),
    authorized: hasCanarySession(request),
  });
}

export async function POST(request: NextRequest) {
  if (!canaryEnabled()) {
    return NextResponse.json({ error: "Canary mode is disabled" }, { status: 404 });
  }

  const body = (await request.json()) as { secret?: string };
  const token = createCanarySessionToken(body.secret || "");
  if (!token) {
    return NextResponse.json({ error: "Invalid canary secret" }, { status: 401 });
  }

  const response = NextResponse.json({ authorized: true });
  response.cookies.set(CANARY_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 2 * 60 * 60,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authorized: false });
  response.cookies.set(CANARY_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
