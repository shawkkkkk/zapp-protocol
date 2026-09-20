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


export function validateTokenImageBytes(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (bytes.length === 0 || bytes.length > MAX_TOKEN_IMAGE_BYTES) return false;

  if (contentType === "image/png") {
    const sig = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
    return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 4 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (contentType === "image/gif") {
    if (bytes.length < 6) return false;
    const header = new TextDecoder("ascii").decode(bytes.slice(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  if (contentType === "image/webp") {
    if (bytes.length < 12) return false;
    const ascii = new TextDecoder("ascii");
    return ascii.decode(bytes.slice(0, 4)) === "RIFF" &&
      ascii.decode(bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}
