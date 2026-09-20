export const MAX_TOKEN_IMAGE_BYTES = 2 * 1024 * 1024;

export const TOKEN_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function buildImageUploadMessage(input: {
  sha256: string;
  byteSize: number;
  contentType: string;
}): string {
  return [
    "ZAPP_IMAGE_V1",
    input.sha256.toLowerCase(),
    String(input.byteSize),
    input.contentType.toLowerCase(),
  ].join(":");
}

export function internalImagePath(sha256: string): string {
  if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("Invalid image hash");
  return "/api/images/" + sha256.toLowerCase();
}
