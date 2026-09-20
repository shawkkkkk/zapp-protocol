import { NextRequest, NextResponse } from "next/server";
import { inspectMint } from "@/lib/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const mint = request.nextUrl.searchParams.get("mint")?.trim();
    if (!mint) {
      return NextResponse.json({ error: "mint is required" }, { status: 400 });
    }
    return NextResponse.json({ mint: await inspectMint(mint) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to inspect mint" },
      { status: 400 },
    );
  }
}
