import { database, confirmIndexedClaim } from "../src/lib/server/db.ts";
import { decodeClaimPayload, hexToBytes } from "../src/lib/protocol.ts";
import { findBurnRawByCommitment } from "../src/lib/server/solana-raw.ts";
import { validateProofAgainstBurn } from "../src/lib/validation.ts";
import {
  findClaimPayloads,
  getZcashBlock,
  getZcashBlockCount,
  getZcashBlockHash,
} from "../src/lib/server/zcash.ts";

const STATE = "zcash-mainnet-v1";

function markerZats(): bigint {
  return BigInt(process.env.ZCASH_MARKER_ZATS || "1000");
}

async function reconcileReorg(startHeight: number): Promise<number> {
  const db = database();
  const state = await db.query<{ height: string; block_hash: string }>(
    "SELECT height, block_hash FROM indexer_state WHERE name=$1",
    [STATE],
  );
  if (!state.rows[0]) return startHeight - 1;

  let height = Number(state.rows[0].height);
  while (height >= startHeight) {
    const stored = await db.query<{ hash: string }>("SELECT hash FROM zcash_blocks WHERE height=$1", [height]);
    if (!stored.rows[0]) {
      height -= 1;
      continue;
    }
    const canonical = await getZcashBlockHash(height);
    if (canonical === stored.rows[0].hash) break;
    height -= 1;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE claims SET status='invalidated', zcash_height=NULL, zcash_tx_index=NULL, updated_at=NOW() WHERE zcash_height > $1",
      [height],
    );
    await client.query("DELETE FROM zcash_blocks WHERE height > $1", [height]);
    if (height >= startHeight) {
      const hash = await getZcashBlockHash(height);
      await client.query(
        `INSERT INTO indexer_state(name,height,block_hash) VALUES($1,$2,$3)
         ON CONFLICT(name) DO UPDATE SET height=EXCLUDED.height, block_hash=EXCLUDED.block_hash, updated_at=NOW()`,
        [STATE, height, hash],
      );
    } else {
      await client.query("DELETE FROM indexer_state WHERE name=$1", [STATE]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return height;
}

function recipientMarkerVout(
  tx: { vout: Array<{ n: number; valueZat?: number; scriptPubKey: { addresses?: string[] } }> },
  recipient: string,
): number | null {
  const matches = tx.vout.filter(
    (vout) =>
      (vout.scriptPubKey.addresses || []).includes(recipient) &&
      BigInt(vout.valueZat ?? -1) === markerZats(),
  );
  return matches.length === 1 ? matches[0].n : null;
}

async function indexBlock(height: number): Promise<void> {
  const db = database();
  const block = await getZcashBlock(height);

  for (let txIndex = 0; txIndex < block.tx.length; txIndex += 1) {
    const tx = block.tx[txIndex];
    const carriers = findClaimPayloads(tx);
    if (carriers.length !== 1) continue;

    const carrier = carriers[0];
    let proof;
    try {
      proof = decodeClaimPayload(hexToBytes(carrier.payloadHex));
    } catch {
      continue;
    }

    const burn = await findBurnRawByCommitment(proof.mint, proof.burnId);
    if (!burn) continue;

    const recipientVout = recipientMarkerVout(tx, burn.recipient);
    if (recipientVout === null) continue;

    const validation = validateProofAgainstBurn(proof, burn, burn.recipient);
    if (!validation.valid) continue;

    await confirmIndexedClaim({
      evidence: burn,
      payloadHex: carrier.payloadHex,
      zcashTxid: tx.txid,
      zcashHeight: height,
      zcashTxIndex: txIndex,
      recipientVout,
      carrierVout: carrier.vout,
    });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO zcash_blocks(height,hash) VALUES($1,$2) ON CONFLICT(height) DO UPDATE SET hash=EXCLUDED.hash",
      [height, block.hash],
    );
    await client.query(
      `INSERT INTO indexer_state(name,height,block_hash) VALUES($1,$2,$3)
       ON CONFLICT(name) DO UPDATE SET height=EXCLUDED.height, block_hash=EXCLUDED.block_hash, updated_at=NOW()`,
      [STATE, height, block.hash],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  console.log(`indexed zcash height ${height} ${block.hash}`);
}

async function syncOnce(): Promise<void> {
  const startHeight = Number.parseInt(process.env.ZAPP_ZCASH_START_HEIGHT || "0", 10);
  if (!Number.isSafeInteger(startHeight) || startHeight < 0) throw new Error("Invalid ZAPP_ZCASH_START_HEIGHT");

  const last = await reconcileReorg(startHeight);
  const tip = await getZcashBlockCount();
  const confirmations = Math.max(1, Number.parseInt(process.env.ZCASH_MIN_CONFIRMATIONS || "1", 10));
  const safeTip = tip - (confirmations - 1);

  for (let height = Math.max(startHeight, last + 1); height <= safeTip; height += 1) {
    await indexBlock(height);
  }
}

async function main() {
  const watch = process.argv.includes("--watch");
  do {
    await syncOnce();
    if (!watch) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
