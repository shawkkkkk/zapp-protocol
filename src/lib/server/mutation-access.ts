import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const CANARY_COOKIE = "zapp_canary_session";

function canaryToken(): string | null {
  const secret = process.env.ZAPP_CANARY_SECRET;
  if (!secret || secret.length < 24) return null;
  return createHmac("sha256", secret)
    .update("ZAPP_CANARY_SESSION_V1")
    .digest("hex");
}

export function canaryEnabled(): boolean {
  return process.env.ZAPP_CANARY_ENABLED === "true" && canaryToken() !== null;
}

export function hasCanarySession(request: NextRequest): boolean {
  if (!canaryEnabled()) return false;
  const expected = canaryToken();
  const actual = request.cookies.get(CANARY_COOKIE)?.value || "";
  if (!expected || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function mutationAllowed(request: NextRequest): boolean {
  return (
    process.env.ZAPP_PUBLIC_LAUNCH_ENABLED === "true" ||
    hasCanarySession(request)
  );
}

export function createCanarySessionToken(providedSecret: string): string | null {
  if (!canaryEnabled()) return null;
  const configured = process.env.ZAPP_CANARY_SECRET || "";
  const providedHash = createHmac("sha256", "ZAPP_CANARY_COMPARE")
    .update(providedSecret)
    .digest();
  const configuredHash = createHmac("sha256", "ZAPP_CANARY_COMPARE")
    .update(configured)
    .digest();
  if (!timingSafeEqual(providedHash, configuredHash)) return null;
  return canaryToken();
}
