import { createHash } from "node:crypto";
import type { BurnEvidence } from "./validation.ts";

export const ZAPP_NFT_CONTENT_TYPE = "application/json";
export const ZAPP_NFT_PROTOCOL = "zapp";
export const ZAPP_NFT_VERSION = 1;

export type ZAppNftContent = {
  p: "zapp";
  op: "mint";
  v: 1;
  mint: string;
  burn: string;
  burnId: string;
  amt: string;
  to: string;
};

export function nftContentForBurn(burn: BurnEvidence): ZAppNftContent {
  return {
    p: ZAPP_NFT_PROTOCOL,
    op: "mint",
    v: ZAPP_NFT_VERSION,
    mint: burn.mint,
    burn: burn.signature,
    burnId: burn.burnId,
    amt: burn.amount.toString(),
    to: burn.recipient,
  };
}

export function encodeNftContent(content: ZAppNftContent): Uint8Array {
  // Canonical field order is protocol-significant.
  const canonical =
    `{"p":"zapp","op":"mint","v":1,"mint":"${content.mint}","burn":"${content.burn}","burnId":"${content.burnId}","amt":"${content.amt}","to":"${content.to}"}`;
  return new TextEncoder().encode(canonical);
}

export function parseNftContent(bytes: Uint8Array): ZAppNftContent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const c = parsed as Partial<ZAppNftContent>;
  if (
    c.p !== "zapp" ||
    c.op !== "mint" ||
    c.v !== 1 ||
    typeof c.mint !== "string" ||
    typeof c.burn !== "string" ||
    typeof c.burnId !== "string" ||
    typeof c.amt !== "string" ||
    typeof c.to !== "string"
  ) return null;
  if (!/^[1-9]\d*$/.test(c.amt)) return null;

  const typed = c as ZAppNftContent;
  const canonical = encodeNftContent(typed);
  if (new TextDecoder().decode(canonical) !== new TextDecoder().decode(bytes)) return null;
  return typed;
}

export function nftContentCommitment(content: Uint8Array): string {
  return createHash("sha256")
    .update("ZAPP_NFT_V1\0")
    .update(content)
    .digest("hex");
}
