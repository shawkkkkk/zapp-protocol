import { NextRequest, NextResponse } from "next/server";
import { mutationAllowed } from "@/lib/server/mutation-access";
import {
  ensureAssetWatchCursor,
  listAssetsForDiscovery,
  upsertAsset,
  type AssetDiscoverySort,
} from "@/lib/server/db";
import { enforceRateLimit, RateLimitError, rateLimitResponse } from "@/lib/server/rate-limit";
import { getFinalizedSolanaSlot } from "@/lib/server/solana-raw";
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
    if (!mutationAllowed(request)) {
      return NextResponse.json(
        { error: "ZApp public launch is not enabled yet" },
        { status: 503 },
      );
    }
    const body = await request.json() as Record<string, unknown>;
    const mint = cleanText(body.mint, "mint", 64);
    const creator = cleanText(body.creator, "creator", 64);
    await enforceRateLimit(request, {
      namespace: "asset-register-ip",
      limit: 12,
      windowSeconds: 3600,
    });
    await enforceRateLimit(request, {
      namespace: "asset-register-creator",
      limit: 12,
      windowSeconds: 3600,
      identity: creator,
    });
    const creationSignature = cleanText(body.creationSignature, "creationSignature", 128);
    const registrationSignature = cleanText(body.registrationSignature, "registrationSignature", 128);
    const name = cleanText(body.name, "name", 48);
    const symbol = cleanText(body.symbol, "symbol", 12).toUpperCase();
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim().slice(0, 500)
        : null;
    const minBurnBaseUnits =
      typeof body.minBurnBaseUnits === "string" && /^[1-9]\d*$/.test(body.minBurnBaseUnits.trim())
        ? body.minBurnBaseUnits.trim()
        : (() => { throw new Error("minBurnBaseUnits must be a positive integer string"); })();
    const imageUrl = sanitizePublicUrl(body.imageUrl);
    const websiteUrl = sanitizePublicUrl(body.websiteUrl);
    const xUrl = sanitizePublicUrl(body.xUrl);

    verifyLaunchAuthorization({
      mint,
      creator,
      creationSignature,
      registrationSignature,
      name,
      symbol,
      imageUrl,
      description,
      websiteUrl,
      xUrl,
      minBurnBaseUnits,
    });
    const watchStartSlot = await getFinalizedSolanaSlot();
    const verified = await verifyLaunchRegistration({ creationSignature, mint, creator });
    const asset = await upsertAsset({
      mint,
      creator,
      name,
      symbol,
      description,
      imageUrl,
      websiteUrl,
      xUrl,
      minBurnBaseUnits,
      creationSignature,
      registrationSignature,
      tokenProgram: verified.tokenProgram,
      decimals: verified.decimals,
      launchSlot: verified.launchSlot,
    });

    await ensureAssetWatchCursor(asset.mint, watchStartSlot);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Asset registration failed" },
      { status: 400 },
    );
  }
}
