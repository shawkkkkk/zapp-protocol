import nacl from "tweetnacl";
import { base58Decode, hexToBytes } from "../protocol.ts";
import { buildLaunchMessage, type LaunchMessageInput } from "../launch.ts";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import { fetchFinalizedRawTransaction } from "./solana-raw.ts";

function connection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", {
    commitment: "finalized",
  });
}


export async function inspectMint(mint: string): Promise<{
  mint: string;
  tokenProgram: string;
  decimals: number;
  supplyBaseUnits: string;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
}> {
  const rpc = connection();
  const mintKey = new PublicKey(mint);
  const info = await rpc.getAccountInfo(mintKey, "confirmed");
  if (!info) throw new Error("Mint account does not exist");

  let tokenProgram: PublicKey;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) tokenProgram = TOKEN_PROGRAM_ID;
  else if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) tokenProgram = TOKEN_2022_PROGRAM_ID;
  else throw new Error("Asset is not an SPL Token or Token-2022 mint");

  const mintInfo = await getMint(rpc, mintKey, "confirmed", tokenProgram);
  return {
    mint: mintKey.toBase58(),
    tokenProgram: tokenProgram.toBase58(),
    decimals: mintInfo.decimals,
    supplyBaseUnits: mintInfo.supply.toString(),
    mintAuthorityRevoked: mintInfo.mintAuthority === null,
    freezeAuthorityRevoked: mintInfo.freezeAuthority === null,
  };
}

export async function verifyLaunchRegistration(input: {
  creationSignature: string;
  mint: string;
  creator: string;
}): Promise<{
  tokenProgram: string;
  decimals: number;
  launchSlot: number;
}> {
  const tx = await fetchFinalizedRawTransaction(input.creationSignature);
  if (!tx.meta || tx.meta.err !== null) throw new Error("Mint creation transaction failed");
  if (tx.transaction.signatures[0] !== input.creationSignature) {
    throw new Error("Creation transaction signature mismatch");
  }

  const signerCount = tx.transaction.message.header.numRequiredSignatures;
  const signers = tx.transaction.message.accountKeys.slice(0, signerCount);
  if (signers[0] !== input.creator) {
    throw new Error("Creator must be the fee payer / first signer of the mint creation transaction");
  }
  if (!signers.includes(input.mint)) {
    throw new Error("Mint account did not sign the claimed creation transaction");
  }

  const rpc = connection();
  const mintKey = new PublicKey(input.mint);
  const info = await rpc.getAccountInfo(mintKey, "finalized");
  if (!info) throw new Error("Mint account does not exist");

  let tokenProgram: PublicKey;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) tokenProgram = TOKEN_PROGRAM_ID;
  else if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) tokenProgram = TOKEN_2022_PROGRAM_ID;
  else throw new Error("Asset is not an SPL Token or Token-2022 mint");

  const mintInfo = await getMint(rpc, mintKey, "finalized", tokenProgram);
  if (mintInfo.mintAuthority !== null) {
    throw new Error("Public ZApp launches require revoked mint authority");
  }

  return {
    tokenProgram: tokenProgram.toBase58(),
    decimals: mintInfo.decimals,
    launchSlot: tx.slot,
  };
}

export function sanitizePublicUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("URL fields must be strings");
  const url = new URL(value.trim());
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  return url.toString();
}

export function verifyLaunchAuthorization(
  input: LaunchMessageInput & { creator: string; registrationSignature: string },
): void {
  const publicKey = base58Decode(input.creator);
  if (publicKey.length !== 32) throw new Error("Creator is not a Solana public key");
  const signature = hexToBytes(input.registrationSignature, 64);
  const message = new TextEncoder().encode(buildLaunchMessage(input));
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("Launch metadata was not signed by the creator wallet");
  }
}
