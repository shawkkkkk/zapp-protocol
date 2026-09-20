import { database, getNftQueueStats, getServiceHealth } from "./db.ts";
import { ZcashRpc } from "./zcash.ts";

export const SOLANA_MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export type ReadinessCheck = {
  ok: boolean;
  name: string;
  detail: string;
};

async function solanaRpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const url = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "zapp-readiness", method, params }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const body = await response.json() as { result?: T; error?: { message?: string } };
  if (body.error || body.result === undefined) {
    throw new Error(body.error?.message || "RPC returned no result");
  }
  return body.result;
}

export async function readinessChecks(): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];

  try {
    const db = database();
    const schema = await db.query<{ claims: string | null; nfts: string | null; assets: string | null }>(
      "SELECT to_regclass('public.claims')::text AS claims, to_regclass('public.nft_mints')::text AS nfts, to_regclass('public.assets')::text AS assets",
    );
    const row = schema.rows[0];
    const ok = Boolean(row?.claims && row?.nfts && row?.assets);
    checks.push({
      ok,
      name: "database",
      detail: ok ? "required tables are present" : "database migrations are incomplete",
    });
  } catch (error) {
    checks.push({ ok: false, name: "database", detail: error instanceof Error ? error.message : "database unavailable" });
  }

  try {
    const genesis = await solanaRpc<string>("getGenesisHash");
    checks.push({
      ok: genesis === SOLANA_MAINNET_GENESIS_HASH,
      name: "solana-mainnet",
      detail: genesis === SOLANA_MAINNET_GENESIS_HASH ? "mainnet RPC verified" : "wrong Solana cluster: " + genesis,
    });
  } catch (error) {
    checks.push({ ok: false, name: "solana-mainnet", detail: error instanceof Error ? error.message : "Solana RPC unavailable" });
  }

  try {
    const rpc = new ZcashRpc();
    const chain = await rpc.call<{
      chain?: string;
      blocks?: number;
      headers?: number;
      verificationprogress?: number;
    }>("getblockchaininfo");
    const blocks = chain.blocks ?? 0;
    const headers = chain.headers ?? blocks;
    const lag = Math.max(0, headers - blocks);
    const progress = chain.verificationprogress ?? 1;
    const ok = chain.chain === "main" && lag <= 2 && progress >= 0.999;
    checks.push({
      ok,
      name: "zcash-mainnet",
      detail: ok
        ? "mainnet node synced at height " + blocks
        : `chain=${chain.chain || "unknown"} blocks=${blocks} headers=${headers} progress=${progress}`,
    });

    const signer = process.env.ZAPP_NFT_SIGNER_TADDR;
    if (!signer) {
      checks.push({ ok: false, name: "zcash-signer-wallet", detail: "ZAPP_NFT_SIGNER_TADDR is missing" });
    } else {
      const address = await rpc.call<{ isvalid: boolean; ismine?: boolean; isscript?: boolean; pubkey?: string }>(
        "validateaddress",
        [signer],
      );
      checks.push({
        ok: Boolean(address.isvalid && address.ismine && !address.isscript && address.pubkey),
        name: "zcash-signer-wallet",
        detail: address.isvalid && address.ismine && !address.isscript && address.pubkey
          ? "wallet owns the compressed reveal signer"
          : "configured reveal signer is not a spendable wallet-owned t1 key",
      });
    }

    const balance = await rpc.call<number>("getbalance");
    const minimum = Number(process.env.ZAPP_MIN_RELAY_BALANCE_ZEC || "0.01");
    checks.push({
      ok: Number.isFinite(balance) && balance >= minimum,
      name: "zcash-relay-balance",
      detail: `${balance} ZEC available; minimum ${minimum} ZEC`,
    });
  } catch (error) {
    checks.push({ ok: false, name: "zcash-rpc", detail: error instanceof Error ? error.message : "Zcash RPC unavailable" });
  }

  try {
    const health = await getServiceHealth("nft-worker");
    if (!health) {
      checks.push({ ok: false, name: "nft-worker", detail: "no worker heartbeat recorded" });
    } else {
      const ageMs = Date.now() - new Date(health.heartbeat_at).getTime();
      const fresh = ageMs >= 0 && ageMs <= 45_000;
      checks.push({
        ok: fresh && health.status === "ready",
        name: "nft-worker",
        detail: fresh ? health.status + (health.details ? ": " + health.details : "") : "worker heartbeat is stale",
      });
    }
  } catch (error) {
    checks.push({ ok: false, name: "nft-worker", detail: error instanceof Error ? error.message : "worker health unavailable" });
  }

  try {
    const queue = await getNftQueueStats();
    checks.push({
      ok: true,
      name: "nft-queue",
      detail: `queued=${queue.queued} active=${queue.active} confirmed=${queue.confirmed} failed=${queue.failed}`,
    });
  } catch (error) {
    checks.push({ ok: false, name: "nft-queue", detail: error instanceof Error ? error.message : "queue unavailable" });
  }

  return checks;
}

export async function launchReadiness(): Promise<{
  ready: boolean;
  publicLaunchEnabled: boolean;
  checks: ReadinessCheck[];
}> {
  const checks = await readinessChecks();
  const publicLaunchEnabled = process.env.ZAPP_PUBLIC_LAUNCH_ENABLED === "true";
  return {
    ready: publicLaunchEnabled && checks.every((check) => check.ok),
    publicLaunchEnabled,
    checks,
  };
}
