import { NextResponse } from "next/server";
import { getLaunchImage } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const image = await getLaunchImage(hash.toLowerCase());
  if (!image) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "content-type": image.content_type,
      "content-length": String(image.byte_size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
