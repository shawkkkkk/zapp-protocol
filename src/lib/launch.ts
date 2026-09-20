export type LaunchMessageInput = {
  mint: string;
  creationSignature: string;
  name: string;
  symbol: string;
  imageUrl?: string | null;
  description?: string | null;
};

export function buildLaunchMessage(input: LaunchMessageInput): string {
  return "ZAPP_LAUNCH_V1:" + JSON.stringify([
    input.mint.trim(),
    input.creationSignature.trim(),
    input.name.trim(),
    input.symbol.trim().toUpperCase(),
    (input.imageUrl || "").trim(),
    (input.description || "").trim(),
  ]);
}
