import { NextRequest, NextResponse } from "next/server";
import { inspectMint } from "@/lib/server/assets";
import { enforceRateLimit, RateLimitError, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const mint = request.nextUrl.searchParams.get("mint")?.trim();
    if (!mint) {
      return NextResponse.json({ error: "mint is required" }, { status: 400 });
    }
    await enforceRateLimit(request, {
      namespace: "mint-inspect-ip",
      limit: 90,
      windowSeconds: 3600,
    });
    return NextResponse.json({ mint: await inspectMint(mint) });
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to inspect mint" },
      { status: 400 },
    );
  }
}
