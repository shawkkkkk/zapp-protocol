import { NextResponse } from "next/server";
import { getNftQueueStats } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let queue = null;
  try {
    if (process.env.DATABASE_URL) queue = await getNftQueueStats();
  } catch {
    queue = null;
  }

  return NextResponse.json({
    name: "ZApp",
    protocolVersion: 1,
    sourceChain: "solana-mainnet",
    anchorChain: "zcash-mainnet",
    nativeZsa: false,
    launchpadEnabled: process.env.ZAPP_REQUIRE_REGISTERED_ASSET !== "false",
    nftMintEnabled: process.env.ZAPP_NFT_MINT_ENABLED !== "false",
    relayConfigured: Boolean(
      process.env.ZCASH_RPC_URL &&
      process.env.ZCASH_RPC_USER &&
      process.env.ZCASH_RPC_PASSWORD &&
      process.env.ZAPP_NFT_SIGNER_TADDR
    ),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    nftQueue: queue,
  });
}
