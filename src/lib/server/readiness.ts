import { database, getNftQueueStats, getServiceHealth } from "./db.ts";

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

  const publicGate = process.env.ZAPP_PUBLIC_LAUNCH_ENABLED === "true";
  const canaryAccess = process.env.ZAPP_CANARY_ENABLED === "true";
  const nftMintEnabled = process.env.ZAPP_NFT_MINT_ENABLED !== "false";
  checks.push({
    ok: nftMintEnabled,
    name: "nft-mint-switch",
    detail: nftMintEnabled ? "NFT minting enabled" : "NFT minting is administratively paused",
  });
  checks.push({
    ok: !publicGate || !canaryAccess,
    name: "canary-access",
    detail:
      publicGate && canaryAccess
        ? "disable private canary access before opening public launch"
        : canaryAccess
          ? "private canary access enabled while public gate is locked"
          : "private canary access disabled",
  });

  try {
    const db = database();
    const schema = await db.query<{
      claims: string | null;
      nfts: string | null;
      assets: string | null;
      images: string | null;
      rate_limits: string | null;
      min_burn_column: string | null;
      creation_sig_column: string | null;
      registration_sig_column: string | null;
      indexer_verified_column: string | null;
      watch_cursors: string | null;
      registered_supply_column: string | null;
      service_health_metadata_column: string | null;
    }>(
      `SELECT
         to_regclass('public.claims')::text AS claims,
         to_regclass('public.nft_mints')::text AS nfts,
         to_regclass('public.assets')::text AS assets,
         to_regclass('public.launch_images')::text AS images,
         to_regclass('public.api_rate_limits')::text AS rate_limits,
         (
           SELECT column_name
           FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='assets'
             AND column_name='min_burn_base_units'
           LIMIT 1
         ) AS min_burn_column,
         (
           SELECT column_name
           FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='assets'
             AND column_name='creation_signature'
           LIMIT 1
         ) AS creation_sig_column,
         (
           SELECT column_name
           FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='assets'
             AND column_name='registration_signature'
           LIMIT 1
         ) AS registration_sig_column,
         (
           SELECT column_name
           FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='nft_mints'
             AND column_name='indexer_verified_at'
           LIMIT 1
         ) AS indexer_verified_column,
         to_regclass('public.asset_watch_cursors')::text AS watch_cursors,
         (
           SELECT column_name
           FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='assets'
             AND column_name='registered_supply_base_units'
           LIMIT 1
         ) AS registered_supply_column,
         (
           SELECT column_name
           FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='service_health'
             AND column_name='metadata'
           LIMIT 1
         ) AS service_health_metadata_column`,
    );
    const row = schema.rows[0];
    const ok = Boolean(
      row?.claims &&
      row?.nfts &&
      row?.assets &&
      row?.images &&
      row?.rate_limits &&
      row?.min_burn_column &&
      row?.creation_sig_column &&
      row?.registration_sig_column &&
      row?.indexer_verified_column &&
      row?.watch_cursors &&
      row?.registered_supply_column &&
      row?.service_health_metadata_column
    );
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
    const rpcUrl = new URL(
      process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    );
    const shared =
      rpcUrl.hostname === "api.mainnet-beta.solana.com" ||
      rpcUrl.hostname === "api.mainnet-beta.solana.com.";
    checks.push({
      ok: !shared,
      name: "solana-dedicated-rpc",
      detail: shared
        ? "shared public Solana RPC is not permitted for public launch"
        : "dedicated Solana RPC configured",
    });

    const probeSignature =
      process.env.ZAPP_SOLANA_HISTORY_PROBE_SIGNATURE ||
      "4hCLg38ijA3tiTVwUFbE4ktZBvEPLPLmRHzTMLEx3MeCEMNCDWNTHi4wwYTawAwua2T7jfpvpforJgyd2zyCxDBK";
    const historic = await solanaRpc<unknown>("getTransaction", [
      probeSignature,
      {
        commitment: "finalized",
        maxSupportedTransactionVersion: 1,
        encoding: "json",
      },
    ]);
    checks.push({
      ok: historic !== null,
      name: "solana-history",
      detail:
        historic !== null
          ? "finalized transaction-history lookup succeeded"
          : "RPC returned null for the history probe",
    });
  } catch (error) {
    checks.push({
      ok: false,
      name: "solana-history",
      detail:
        error instanceof Error
          ? error.message
          : "Solana transaction-history lookup failed",
    });
  }

  try {
    const rawOrigin =
      process.env.ZAPP_CANONICAL_ORIGIN ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "";
    const origin = new URL(rawOrigin);
    const normalized = origin.origin;
    const isHttps = origin.protocol === "https:";
    const isPermanent =
      !origin.hostname.endsWith(".up.railway.app") &&
      origin.hostname !== "localhost";
    const noPath =
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash;
    checks.push({
      ok: isHttps && isPermanent && noPath,
      name: "canonical-origin",
      detail:
        isHttps && isPermanent && noPath
          ? normalized
          : "configure the permanent HTTPS custom domain before public token creation",
    });
  } catch {
    checks.push({
      ok: false,
      name: "canonical-origin",
      detail: "ZAPP_CANONICAL_ORIGIN/NEXT_PUBLIC_APP_URL is not a valid public origin",
    });
  }

  try {
    const health = await getServiceHealth("nft-worker");
    const metadata = health?.metadata || {};
    const chain = typeof metadata.chain === "string" ? metadata.chain : undefined;
    const blocks = typeof metadata.blocks === "number" ? metadata.blocks : undefined;
    const headers = typeof metadata.headers === "number" ? metadata.headers : undefined;
    const progress =
      typeof metadata.verificationProgress === "number"
        ? metadata.verificationProgress
        : undefined;
    const signerOk = metadata.signerOk === true;
    const balance =
      typeof metadata.balanceZec === "number" ? metadata.balanceZec : undefined;
    const minimum =
      typeof metadata.minimumBalanceZec === "number"
        ? metadata.minimumBalanceZec
        : Number(process.env.ZAPP_MIN_RELAY_BALANCE_ZEC || "0.01");
    const relayOk = metadata.relayOk === true;

    checks.push({
      ok:
        relayOk &&
        chain === "main" &&
        blocks !== undefined &&
        headers !== undefined &&
        Math.max(0, headers - blocks) <= 2 &&
        (progress ?? 0) >= 0.999,
      name: "zcash-mainnet",
      detail:
        relayOk && chain === "main" && blocks !== undefined
          ? "private worker reports synced Zcash mainnet at height " + blocks
          : "private worker has not reported a synced Zcash mainnet relay",
    });

    checks.push({
      ok: relayOk && signerOk,
      name: "zcash-signer-wallet",
      detail:
        relayOk && signerOk
          ? "private worker validated the wallet-owned compressed reveal signer"
          : "private worker has not validated the reveal signer",
    });

    checks.push({
      ok:
        relayOk &&
        balance !== undefined &&
        Number.isFinite(balance) &&
        balance >= minimum,
      name: "zcash-relay-balance",
      detail:
        balance !== undefined
          ? balance + " ZEC available; minimum " + minimum + " ZEC"
          : "private worker has not reported relay balance",
    });
  } catch (error) {
    checks.push({
      ok: false,
      name: "zcash-mainnet",
      detail:
        error instanceof Error
          ? "private worker relay health unavailable: " + error.message
          : "private worker relay health unavailable",
    });
    checks.push({
      ok: false,
      name: "zcash-signer-wallet",
      detail: "private worker relay health unavailable",
    });
    checks.push({
      ok: false,
      name: "zcash-relay-balance",
      detail: "private worker relay health unavailable",
    });
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
    const health = await getServiceHealth("solana-watcher");
    if (!health) {
      checks.push({
        ok: false,
        name: "solana-watcher",
        detail: "no automatic burn watcher heartbeat recorded",
      });
    } else {
      const ageMs = Date.now() - new Date(health.heartbeat_at).getTime();
      const fresh = ageMs >= 0 && ageMs <= 60_000;
      checks.push({
        ok: fresh && health.status === "ready",
        name: "solana-watcher",
        detail: fresh
          ? health.status + (health.details ? ": " + health.details : "")
          : "Solana watcher heartbeat is stale",
      });
    }
  } catch (error) {
    checks.push({
      ok: false,
      name: "solana-watcher",
      detail:
        error instanceof Error
          ? error.message
          : "Solana watcher health unavailable",
    });
  }

  try {
    const health = await getServiceHealth("zcash-indexer");
    if (!health) {
      checks.push({ ok: false, name: "zcash-indexer", detail: "no indexer heartbeat recorded" });
    } else {
      const ageMs = Date.now() - new Date(health.heartbeat_at).getTime();
      const fresh = ageMs >= 0 && ageMs <= 90_000;
      checks.push({
        ok: fresh && health.status === "ready",
        name: "zcash-indexer",
        detail: fresh ? health.status + (health.details ? ": " + health.details : "") : "indexer heartbeat is stale",
      });
    }
  } catch (error) {
    checks.push({
      ok: false,
      name: "zcash-indexer",
      detail: error instanceof Error ? error.message : "indexer health unavailable",
    });
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
  infrastructureReady: boolean;
  publicLaunchEnabled: boolean;
  checks: ReadinessCheck[];
}> {
  const checks = await readinessChecks();
  const infrastructureReady = checks.every((check) => check.ok);
  const publicLaunchEnabled = process.env.ZAPP_PUBLIC_LAUNCH_ENABLED === "true";
  return {
    ready: publicLaunchEnabled && infrastructureReady,
    infrastructureReady,
    publicLaunchEnabled,
    checks,
  };
}
