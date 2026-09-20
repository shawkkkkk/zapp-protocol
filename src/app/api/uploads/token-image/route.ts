import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import { NextRequest, NextResponse } from "next/server";
import { base58Decode, hexToBytes } from "@/lib/protocol";
import {
  MAX_TOKEN_IMAGE_BYTES,
  TOKEN_IMAGE_TYPES,
  buildImageUploadMessage,
  internalImagePath,
  validateTokenImageBytes,
} from "@/lib/image-upload";
import { putLaunchImage } from "@/lib/server/db";
import { enforceRateLimit, RateLimitError, rateLimitResponse } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const creator = String(form.get("creator") || "").trim();
    const signatureHex = String(form.get("signature") || "").trim();

    if (!(file instanceof File)) throw new Error("Image file is required");
    if (!creator) throw new Error("Creator wallet is required");

    await enforceRateLimit(request, {
      namespace: "image-upload-ip",
      limit: 30,
      windowSeconds: 3600,
    });
    await enforceRateLimit(request, {
      namespace: "image-upload-wallet",
      limit: 30,
      windowSeconds: 3600,
      identity: creator,
    });
    if (!TOKEN_IMAGE_TYPES.has(file.type)) {
      throw new Error("Use PNG, JPG, GIF, or WebP");
    }
    if (file.size <= 0 || file.size > MAX_TOKEN_IMAGE_BYTES) {
      throw new Error("Image must be 2 MB or smaller");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validateTokenImageBytes(bytes, file.type)) {
      throw new Error("Image contents do not match the declared file type");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const message = new TextEncoder().encode(
      buildImageUploadMessage({
        sha256,
        byteSize: bytes.byteLength,
        contentType: file.type,
      }),
    );

    const publicKey = base58Decode(creator);
    if (publicKey.length !== 32) throw new Error("Creator is not a Solana public key");
    const signature = hexToBytes(signatureHex, 64);
    if (!nacl.sign.detached.verify(message, signature, publicKey)) {
      throw new Error("Image upload was not authorized by the connected wallet");
    }

    await putLaunchImage({
      sha256,
      contentType: file.type,
      data: Buffer.from(bytes),
      creator,
    });

    return NextResponse.json({
      sha256,
      imageUrl: internalImagePath(sha256),
      byteSize: bytes.byteLength,
      contentType: file.type,
    });
  } catch (error) {
    if (error instanceof RateLimitError) return rateLimitResponse(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Image upload failed" },
      { status: 400 },
    );
  }
}
