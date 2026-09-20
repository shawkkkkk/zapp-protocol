import { NextResponse } from "next/server";
import { launchReadiness } from "@/lib/server/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await launchReadiness();
  return NextResponse.json(readiness, { status: readiness.ready ? 200 : 503 });
}
