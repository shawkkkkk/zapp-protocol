import {
  advanceAssetWatchCursor,
  ensureAssetWatchCursor,
  getAssetWatchCursor,
  heartbeatService,
  listAssetsForWatcher,
} from "../src/lib/server/db.ts";
import { processBurnSignature } from "../src/lib/server/claim-service.ts";
import {
  getFinalizedSolanaSlot,
  listFinalizedMintSignatures,
  type FinalizedAddressSignature,
} from "../src/lib/server/solana-raw.ts";

const PAGE_SIZE = 1000;
const MAX_PAGES = Math.max(
  1,
  Number.parseInt(process.env.ZAPP_SOLANA_WATCH_MAX_PAGES || "20", 10),
);

function looksLikeZAppMemo(memo?: string | null): boolean {
  return typeof memo === "string" && memo.includes("ZAPP1:");
}

function isTransientVerificationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Solana RPC") ||
    message.includes("HTTP ") ||
    message.includes("unavailable from this RPC") ||
    message.includes("fetch failed") ||
    message.includes("ECONN") ||
    message.includes("timeout")
  );
}

async function newSignatures(
  mint: string,
): Promise<FinalizedAddressSignature[]> {
  let cursor = await getAssetWatchCursor(mint);
  if (!cursor) {
    const slot = await getFinalizedSolanaSlot();
    cursor = await ensureAssetWatchCursor(mint, slot);
  }

  const startSlot = Number(cursor.start_slot);
  if (!Number.isSafeInteger(startSlot) || startSlot < 0) {
    throw new Error("Invalid watcher start slot for " + mint);
  }

  const collected: FinalizedAddressSignature[] = [];
  let before: string | undefined;
  let reachedBoundary = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await listFinalizedMintSignatures(mint, {
      before,
      until: cursor.last_signature || undefined,
      limit: PAGE_SIZE,
    });

    if (rows.length === 0) {
      reachedBoundary = true;
      break;
    }

    for (const row of rows) {
      if (!cursor.last_signature && row.slot < startSlot) {
        reachedBoundary = true;
        break;
      }
      collected.push(row);
    }

    if (reachedBoundary || rows.length < PAGE_SIZE) {
      reachedBoundary = true;
      break;
    }

    before = rows.at(-1)?.signature;
    if (!before) {
      reachedBoundary = true;
      break;
    }
  }

  if (!reachedBoundary) {
    throw new Error(
      "Solana watcher backlog exceeded " +
        MAX_PAGES +
        " pages for " +
        mint +
        "; refusing to skip signatures",
    );
  }

  // RPC returns newest first. Processing oldest first makes the cursor gap-free.
  return collected.reverse();
}

async function processAsset(mint: string): Promise<number> {
  const rows = await newSignatures(mint);
  let processed = 0;

  for (const row of rows) {
    if (!row.signature) continue;

    if (row.err || !looksLikeZAppMemo(row.memo)) {
      await advanceAssetWatchCursor({
        mint,
        signature: row.signature,
        slot: row.slot,
      });
      continue;
    }

    try {
      const result = await processBurnSignature(row.signature);
      console.log(
        "ZApp watcher queued burn " +
          result.evidence.burnId +
          " for " +
          mint,
      );
      processed += 1;
    } catch (error) {
      if (isTransientVerificationError(error)) throw error;

      // A ZAPP-looking memo that fails deterministic v1 validation is not a
      // canonical claim. Record it in logs and advance so one malformed tx
      // cannot permanently stall an asset.
      console.warn(
        "ZApp watcher rejected noncanonical candidate " +
          row.signature +
          ": " +
          (error instanceof Error ? error.message : String(error)),
      );
    }

    await advanceAssetWatchCursor({
      mint,
      signature: row.signature,
      slot: row.slot,
    });
  }

  return processed;
}

async function syncOnce(): Promise<number> {
  const assets = await listAssetsForWatcher();
  let processed = 0;

  for (const asset of assets) {
    processed += await processAsset(asset.mint);
  }

  return processed;
}

async function main() {
  const watch = process.argv.includes("--watch");
  await heartbeatService(
    "solana-watcher",
    "starting",
    "initial finalized burn scan",
  );

  do {
    try {
      const processed = await syncOnce();
      await heartbeatService(
        "solana-watcher",
        "ready",
        processed
          ? "queued " + processed + " finalized burn(s)"
          : "finalized burn scan current",
      );
      if (processed) {
        console.log("ZApp Solana watcher queued " + processed + " burn(s)");
      }
    } catch (error) {
      await heartbeatService(
        "solana-watcher",
        "error",
        error instanceof Error ? error.message.slice(0, 500) : "watcher error",
      );
      if (!watch) throw error;
      console.error(error);
    }

    if (!watch) break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
