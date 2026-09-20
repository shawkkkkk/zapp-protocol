import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    name: "ZApp",
    protocolVersion: 1,
    sourceChain: "solana-mainnet",
    anchorChain: "zcash-mainnet",
    nativeZsa: false,
    relayConfigured: Boolean(process.env.ZCASH_RPC_URL && process.env.ZCASH_RPC_USER && process.env.ZCASH_RPC_PASSWORD),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  });
}
