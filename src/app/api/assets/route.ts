import { NextRequest, NextResponse } from "next/server";
import { listAssetsForDiscovery, upsertAsset, type AssetDiscoverySort } from "@/lib/server/db";
import {
  sanitizePublicUrl,
  verifyLaunchAuthorization,
  verifyLaunchRegistration,
} from "@/lib/server/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanText(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new Error(name + " is required");
  const out = value.trim();
  if (!out || out.length > max) throw new Error(name + " must be 1-" + max + " characters");
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "50", 10);
    const requestedSort = request.nextUrl.searchParams.get("sort") || "newest";
    const allowed = new Set<AssetDiscoverySort>(["newest","trending","most-burned","recently-stamped"]);
    const sort: AssetDiscoverySort = allowed.has(requestedSort as AssetDiscoverySort)
      ? requestedSort as AssetDiscoverySort
      : "newest";
    return NextResponse.json({
      assets: await listAssetsForDiscovery(sort, Number.isFinite(limit) ? limit : 50),
      sort,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to list assets" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.ZAPP_PUBLIC_LAUNCH_ENABLED !== "true") {
      return NextResponse.json({ error: "ZApp public launch is not enabled yet" }, { status: 503 });
    }
    const body = await request.json() as Record<string, unknown>;
    const mint = cleanText(body.mint, "mint", 64);
    const creator = cleanText(body.creator, "creator", 64);
    const creationSignature = cleanText(body.creationSignature, "creationSignature", 128);
    const registrationSignature = cleanText(body.registrationSignature, "registrationSignature", 128);
    const name = cleanText(body.name, "name", 48);
    const symbol = cleanText(body.symbol, "symbol", 12).toUpperCase();
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, 500)
        : null;

    verifyLaunchAuthorization({
      mint,
      creator,
      creationSignature,
      registrationSignature,
      name,
      symbol,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
      description,
      websiteUrl: typeof body.websiteUrl === "string" ? body.websiteUrl : null,
      xUrl: typeof body.xUrl === "string" ? body.xUrl : null,
    });
    const verified = await verifyLaunchRegistration({ creationSignature, mint, creator });
    const asset = await upsertAsset({
      mint,
      creator,
      name,
      symbol,
      description,
      imageUrl: sanitizePublicUrl(body.imageUrl),
      websiteUrl: sanitizePublicUrl(body.websiteUrl),
      xUrl: sanitizePublicUrl(body.xUrl),
      tokenProgram: verified.tokenProgram,
      decimals: verified.decimals,
      launchSlot: verified.launchSlot,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Asset registration failed" },
      { status: 400 },
    );
  }
}
