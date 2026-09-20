import { NextRequest, NextResponse } from "next/server";
import { getAsset } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function absoluteUrl(origin: string, value: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return new URL(value, origin).toString();
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  const asset = await getAsset(mint);
  if (!asset) {
    return NextResponse.json({ error: "Unknown ZApp asset" }, { status: 404 });
  }

  const origin =
    process.env.ZAPP_CANONICAL_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    request.nextUrl.origin;
  const image = absoluteUrl(origin, asset.image_url);
  const externalUrl = asset.website_url || new URL("/asset/" + asset.mint, origin).toString();

  return NextResponse.json(
    {
      name: asset.name,
      symbol: asset.symbol,
      description:
        asset.description ||
        "A fixed-supply Solana asset registered with the ZApp burn-to-Zcash protocol.",
      image,
      external_url: externalUrl,
      attributes: [
        { trait_type: "Protocol", value: "ZApp" },
        { trait_type: "Source Chain", value: "Solana" },
        { trait_type: "Zcash Claims", value: "Enabled" },
        { trait_type: "Mint Authority", value: "Revoked" },
        { trait_type: "Freeze Authority", value: "Revoked" },
      ],
      properties: image
        ? {
            files: [{ uri: image }],
            category: "image",
          }
        : undefined,
    },
    {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
