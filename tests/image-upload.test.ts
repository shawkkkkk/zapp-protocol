import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImageUploadMessage,
  internalImagePath,
  validateTokenImageBytes,
} from "../src/lib/image-upload.ts";

test("image upload authorization message is canonical", () => {
  assert.equal(
    buildImageUploadMessage({
      sha256: "A".repeat(64),
      byteSize: 123,
      contentType: "IMAGE/PNG",
    }),
    "ZAPP_IMAGE_V1:" + "a".repeat(64) + ":123:image/png",
  );
});

test("image path is content addressed", () => {
  assert.equal(
    internalImagePath("B".repeat(64)),
    "/api/images/" + "b".repeat(64),
  );
  assert.throws(() => internalImagePath("../bad"));
});


test("token image magic bytes must match the declared content type", () => {
  assert.equal(
    validateTokenImageBytes(
      Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00]),
      "image/png",
    ),
    true,
  );
  assert.equal(
    validateTokenImageBytes(
      new TextEncoder().encode("<script>alert(1)</script>"),
      "image/png",
    ),
    false,
  );
  assert.equal(
    validateTokenImageBytes(
      Uint8Array.from([0xff,0xd8,0x00,0x01,0xff,0xd9]),
      "image/jpeg",
    ),
    true,
  );
  assert.equal(
    validateTokenImageBytes(
      new TextEncoder().encode("GIF89ahello"),
      "image/gif",
    ),
    true,
  );
  assert.equal(
    validateTokenImageBytes(
      Uint8Array.from([
        0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50,
      ]),
      "image/webp",
    ),
    true,
  );
});
