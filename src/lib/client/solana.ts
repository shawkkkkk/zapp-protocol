"use client";

import { Buffer } from "buffer";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createBurnCheckedInstruction,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  createV1,
  mplTokenMetadata,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createNoopSigner,
  percentAmount,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  fromWeb3JsPublicKey,
  toWeb3JsInstruction,
} from "@metaplex-foundation/umi-web3js-adapters";
import { buildZAppMemo, parseUiAmount } from "../protocol.ts";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export type WalletProvider = {
  publicKey?: PublicKey;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(transaction: Transaction): Promise<{ signature: string }>;
  signMessage?(message: Uint8Array): Promise<{ signature: Uint8Array }>;
};

export function browserSolanaRpc(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function getInjectedWallet(): WalletProvider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { solana?: WalletProvider }).solana ?? null;
}


function metaplexMetadataInstruction(input: {
  owner: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
}): TransactionInstruction {
  if (!input.name.trim() || input.name.trim().length > 32) {
    throw new Error("On-chain token name must be 1-32 characters");
  }
  if (!input.symbol.trim() || input.symbol.trim().length > 10) {
    throw new Error("On-chain token ticker must be 1-10 characters");
  }
  if (input.uri.length > 200) throw new Error("Token metadata URI is too long");

  const umi = createUmi(browserSolanaRpc()).use(mplTokenMetadata());
  const authority = createNoopSigner(fromWeb3JsPublicKey(input.owner));
  const builder = createV1(umi, {
    mint: fromWeb3JsPublicKey(input.mint),
    authority,
    payer: authority,
    updateAuthority: authority,
    name: input.name.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    uri: input.uri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenStandard: TokenStandard.Fungible,
    splTokenProgram: fromWeb3JsPublicKey(TOKEN_PROGRAM_ID),
    decimals: input.decimals,
    creators: null,
    collection: null,
    uses: null,
    collectionDetails: null,
    ruleSet: null,
    printSupply: null,
    isMutable: false,
  });
  const instructions = builder.getInstructions();
  if (instructions.length !== 1) {
    throw new Error("Unexpected Metaplex metadata instruction count");
  }
  return toWeb3JsInstruction(instructions[0]);
}

async function tokenProgramForMint(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error("Mint account not found");
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  throw new Error("Mint is not owned by SPL Token or Token-2022");
}

export async function buildBurnAndProofTransaction(input: {
  owner: PublicKey;
  mint: string;
  amountUi: string;
  zcashAddress: string;
}): Promise<{ transaction: Transaction; amountBaseUnits: bigint; decimals: number }> {
  const connection = new Connection(browserSolanaRpc(), "confirmed");
  const mint = new PublicKey(input.mint);
  const programId = await tokenProgramForMint(connection, mint);
  const mintInfo = await getMint(connection, mint, "confirmed", programId);
  const amountBaseUnits = parseUiAmount(input.amountUi, mintInfo.decimals);
  const source = getAssociatedTokenAddressSync(mint, input.owner, false, programId);

  const burn = createBurnCheckedInstruction(
    source,
    mint,
    input.owner,
    amountBaseUnits,
    mintInfo.decimals,
    [],
    programId,
  );
  const memo = new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(buildZAppMemo(input.zcashAddress), "utf8"),
  });

  const transaction = new Transaction().add(burn, memo);

  const feeLamportsRaw = process.env.NEXT_PUBLIC_ZAPP_FEE_LAMPORTS || "0";
  const treasury = process.env.NEXT_PUBLIC_ZAPP_FEE_TREASURY;
  const feeLamports = BigInt(feeLamportsRaw);
  if (feeLamports > 0n) {
    if (!treasury) throw new Error("ZApp service fee is configured without a treasury");
    if (feeLamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Configured service fee is too large");
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: input.owner,
        toPubkey: new PublicKey(treasury),
        lamports: Number(feeLamports),
      }),
    );
  }

  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = input.owner;
  transaction.recentBlockhash = latest.blockhash;

  return { transaction, amountBaseUnits, decimals: mintInfo.decimals };
}

export async function buildFixedSupplyMintTransaction(input: {
  owner: PublicKey;
  supplyUi: string;
  decimals: number;
  name: string;
  symbol: string;
  metadataOrigin: string;
}): Promise<{ transaction: Transaction; mintKeypair: Keypair; mint: string; amountBaseUnits: bigint; metadataUri: string }> {
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 9) {
    throw new Error("ZApp's simple token creator supports 0-9 decimals");
  }

  const connection = new Connection(browserSolanaRpc(), "confirmed");
  const mintKeypair = Keypair.generate();
  const amountBaseUnits = parseUiAmount(input.supplyUi, input.decimals);
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const ata = getAssociatedTokenAddressSync(mintKeypair.publicKey, input.owner);
  const origin = input.metadataOrigin.replace(/\/$/, "");
  if (!/^https:\/\//i.test(origin) && !/^http:\/\/localhost(?::\d+)?$/i.test(origin)) {
    throw new Error("Token metadata origin must be HTTPS");
  }
  const metadataUri = origin + "/api/metadata/" + mintKeypair.publicKey.toBase58();
  const metadataIx = metaplexMetadataInstruction({
    owner: input.owner,
    mint: mintKeypair.publicKey,
    name: input.name,
    symbol: input.symbol,
    uri: metadataUri,
    decimals: input.decimals,
  });

  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: input.owner,
      newAccountPubkey: mintKeypair.publicKey,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mintKeypair.publicKey, input.decimals, input.owner, null),
    metadataIx,
    createAssociatedTokenAccountInstruction(input.owner, ata, input.owner, mintKeypair.publicKey),
    createMintToCheckedInstruction(
      mintKeypair.publicKey,
      ata,
      input.owner,
      amountBaseUnits,
      input.decimals,
    ),
    createSetAuthorityInstruction(
      mintKeypair.publicKey,
      input.owner,
      AuthorityType.MintTokens,
      null,
    ),
  );

  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = input.owner;
  transaction.recentBlockhash = latest.blockhash;
  transaction.partialSign(mintKeypair);

  return {
    transaction,
    mintKeypair,
    mint: mintKeypair.publicKey.toBase58(),
    amountBaseUnits,
    metadataUri,
  };
}
