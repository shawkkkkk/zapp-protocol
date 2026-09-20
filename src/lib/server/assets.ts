import nacl from "tweetnacl";
import { base58Decode, hexToBytes } from "../protocol.ts";
import { buildLaunchMessage, type LaunchMessageInput } from "../launch.ts";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import { fetchFinalizedRawTransaction } from "./solana-raw.ts";
import {
  fetchMetadataFromSeeds,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { publicKey } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

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
  metadata: {
    name: string;
    symbol: string;
    uri: string;
    isMutable: boolean;
  } | null;
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

  let metadata: {
    name: string;
    symbol: string;
    uri: string;
    isMutable: boolean;
  } | null = null;
  try {
    const umi = createUmi(
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    ).use(mplTokenMetadata());
    const onchain = await fetchMetadataFromSeeds(umi, {
      mint: publicKey(mintKey.toBase58()),
    });
    metadata = {
      name: onchain.name.replace(/\0/g, "").trim(),
      symbol: onchain.symbol.replace(/\0/g, "").trim(),
      uri: onchain.uri.replace(/\0/g, "").trim(),
      isMutable: onchain.isMutable,
    };
  } catch {
    // Metadata is optional; SPL mint verification remains independent of it.
  }

  return {
    mint: mintKey.toBase58(),
    tokenProgram: tokenProgram.toBase58(),
    decimals: mintInfo.decimals,
    supplyBaseUnits: mintInfo.supply.toString(),
    mintAuthorityRevoked: mintInfo.mintAuthority === null,
    freezeAuthorityRevoked: mintInfo.freezeAuthority === null,
    metadata,
  };
}


export function assertMintCreationEvidence(input: {
  creator: string;
  mint: string;
  accountKeys: string[];
  signerCount: number;
  preBalances?: number[] | null;
  postBalances?: number[] | null;
}): void {
  const signers = input.accountKeys.slice(0, input.signerCount);
  if (signers[0] !== input.creator) {
    throw new Error(
      "Creator must be the fee payer / first signer of the mint creation transaction",
    );
  }

  const mintIndex = input.accountKeys.indexOf(input.mint);
  if (mintIndex < 0) {
    throw new Error("Claimed mint is not present in the creation transaction");
  }

  const mintSignedCreation = signers.includes(input.mint);
  const preLamports = input.preBalances?.[mintIndex];
  const postLamports = input.postBalances?.[mintIndex];
  const programCreatedMint =
    preLamports === 0 &&
    typeof postLamports === "number" &&
    Number.isSafeInteger(postLamports) &&
    postLamports > 0;

  if (!mintSignedCreation && !programCreatedMint) {
    throw new Error(
      "Creation proof must either be signed by the mint or create the mint account from zero balance",
    );
  }
}

export async function verifyLaunchRegistration(input: {
  creationSignature: string;
  mint: string;
  creator: string;
}): Promise<{
  tokenProgram: string;
  decimals: number;
  supplyBaseUnits: string;
  launchSlot: number;
}> {
  const tx = await fetchFinalizedRawTransaction(input.creationSignature);
  if (!tx.meta || tx.meta.err !== null) throw new Error("Mint creation transaction failed");
  if (tx.transaction.signatures[0] !== input.creationSignature) {
    throw new Error("Creation transaction signature mismatch");
  }

  const signerCount = tx.transaction.message.header.numRequiredSignatures;
  assertMintCreationEvidence({
    creator: input.creator,
    mint: input.mint,
    accountKeys: tx.transaction.message.accountKeys,
    signerCount,
    preBalances: tx.meta.preBalances,
    postBalances: tx.meta.postBalances,
  });

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
  if (mintInfo.freezeAuthority !== null) {
    throw new Error("Public ZApp launches require revoked freeze authority");
  }

  return {
    tokenProgram: tokenProgram.toBase58(),
    decimals: mintInfo.decimals,
    supplyBaseUnits: mintInfo.supply.toString(),
    launchSlot: tx.slot,
  };
}

export function sanitizePublicUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("URL fields must be strings");
  const trimmed = value.trim();

  if (/^\/api\/images\/[a-f0-9]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const url = new URL(trimmed);
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("Only http(s) URLs or ZApp-hosted images are allowed");
  }
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
