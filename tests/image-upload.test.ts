import test from "node:test";
import assert from "node:assert/strict";
import { buildImageUploadMessage, internalImagePath } from "../src/lib/image-upload.ts";

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
