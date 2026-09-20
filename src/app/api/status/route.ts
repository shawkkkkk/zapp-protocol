import { NextResponse } from "next/server";
import {
  getNftQueueStats,
  getServiceHealth,
} from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicHealth(
  row: Awaited<ReturnType<typeof getServiceHealth>>,
  freshnessMs: number,
) {
  if (!row) return { status: "missing", fresh: false };
  const ageMs = Date.now() - new Date(row.heartbeat_at).getTime();
  return {
    status: row.status,
    fresh: ageMs >= 0 && ageMs <= freshnessMs,
    heartbeatAt: row.heartbeat_at,
    details: row.details,
  };
}

function permanentOriginConfigured(): boolean {
  try {
    const raw =
      process.env.ZAPP_CANONICAL_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "";
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.hostname.endsWith(".up.railway.app") &&
      url.hostname !== "localhost"
    );
  } catch {
    return false;
  }
}

export async function GET() {
  let queue = null;
  let worker = null;
  let watcher = null;
  let indexer = null;

  try {
    if (process.env.DATABASE_URL) {
      [queue, worker, watcher, indexer] = await Promise.all([
        getNftQueueStats(),
        getServiceHealth("nft-worker"),
        getServiceHealth("solana-watcher"),
        getServiceHealth("zcash-indexer"),
      ]);
    }
  } catch {
    queue = null;
  }

  return NextResponse.json(
    {
      name: "ZApp",
      protocolVersion: 1,
      sourceChain: "solana-mainnet",
      anchorChain: "zcash-mainnet",
      nativeZsa: false,
      publicLaunchEnabled:
        process.env.ZAPP_PUBLIC_LAUNCH_ENABLED === "true",
      canaryEnabled: process.env.ZAPP_CANARY_ENABLED === "true",
      launchpadEnabled:
        process.env.ZAPP_REQUIRE_REGISTERED_ASSET !== "false",
      nftMintEnabled: process.env.ZAPP_NFT_MINT_ENABLED !== "false",
      relayConfigured: worker?.metadata?.relayOk === true,
      dedicatedSolanaRpc: Boolean(
        process.env.SOLANA_RPC_URL &&
          !process.env.SOLANA_RPC_URL.includes(
            "api.mainnet-beta.solana.com",
          ),
      ),
      canonicalOriginConfigured: permanentOriginConfigured(),
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      services: {
        nftWorker: publicHealth(worker, 45_000),
        solanaWatcher: publicHealth(watcher, 60_000),
        zcashIndexer: publicHealth(indexer, 90_000),
      },
      nftQueue: queue,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
