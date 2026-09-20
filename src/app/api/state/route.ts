import { NextResponse } from "next/server";
import { canonicalState } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await canonicalState());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to compute state root" },
      { status: 500 },
    );
  }
}
