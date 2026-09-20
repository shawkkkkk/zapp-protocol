import { NextResponse } from "next/server";
import { database } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (process.env.DATABASE_URL) {
      await database().query("SELECT 1");
    }
    return NextResponse.json({
      ok: true,
      service: "zapp-web",
      database: Boolean(process.env.DATABASE_URL),
      publicLaunchEnabled: process.env.ZAPP_PUBLIC_LAUNCH_ENABLED === "true",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "health check failed" },
      { status: 503 },
    );
  }
}
