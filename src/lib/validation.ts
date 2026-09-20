import type { ZAppProof } from "./protocol.ts";

export type BurnEvidence = {
  burnId: string;
  signature: string;
  instructionLocator: string;
  slot: number;
  mint: string;
  amount: bigint;
  recipient: string;
  authority: string;
  finalized: boolean;
  successful: boolean;
};

export type ValidationResult =
  | { valid: true }
  | { valid: false; code: string; reason: string };

export function validateProofAgainstBurn(
  proof: ZAppProof,
  burn: BurnEvidence | null,
  expectedRecipient?: string,
): ValidationResult {
  if (!burn) return { valid: false, code: "BURN_NOT_FOUND", reason: "No matching finalized Solana burn exists" };
  if (!burn.successful) return { valid: false, code: "BURN_FAILED", reason: "The Solana transaction failed" };
  if (!burn.finalized) return { valid: false, code: "BURN_NOT_FINAL", reason: "The Solana burn is not finalized" };
  if (proof.burnId !== burn.burnId) return { valid: false, code: "BURN_ID_MISMATCH", reason: "Burn commitment does not match" };
  if (proof.mint !== burn.mint) return { valid: false, code: "MINT_MISMATCH", reason: "Proof mint does not match the burned mint" };
  if (proof.amount !== burn.amount) return { valid: false, code: "AMOUNT_MISMATCH", reason: "Proof amount does not equal the destroyed amount" };
  if (expectedRecipient && burn.recipient !== expectedRecipient) {
    return { valid: false, code: "RECIPIENT_MISMATCH", reason: "Zcash marker output does not match the destination committed on Solana" };
  }
  return { valid: true };
}
