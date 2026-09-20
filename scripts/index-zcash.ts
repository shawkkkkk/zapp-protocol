import {
  applyIndexedTransfer,
  database,
  confirmIndexedClaim,
  getClaimByOwnerOutpoint,
  rebuildOwnershipFromTransfers,
  terminateIndexedOwnership,
  heartbeatService,
  markNftIndexerVerified,
} from "../src/lib/server/db.ts";
import { decodeClaimPayload, hexToBytes } from "../src/lib/protocol.ts";
import {
  parseInscriptionRevealScriptSig,
  p2shAddressForRedeemScript,
} from "../src/lib/inscription.ts";
import { parseNftContent, ZAPP_NFT_CONTENT_TYPE } from "../src/lib/nft.ts";
import { findBurnRawByCommitment } from "../src/lib/server/solana-raw.ts";
import { validateProofAgainstBurn } from "../src/lib/validation.ts";
import {
  findClaimPayloads,
  findTransferPayloads,
  getZcashBlock,
  getZcashBlockCount,
  getZcashBlockHash,
  getZcashTransaction,
} from "../src/lib/server/zcash.ts";

const STATE = "zcash-mainnet-v1";

function markerZats(): bigint {
  return BigInt(process.env.ZCASH_MARKER_ZATS || "546");
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
      `UPDATE nft_mints n
       SET indexer_verified_at=NULL,
           indexer_verified_height=NULL,
           status=CASE
             WHEN n.reveal_raw_hex IS NOT NULL THEN 'reveal_broadcast'
             ELSE 'queued'
           END,
           error=NULL,
           updated_at=NOW()
       WHERE n.burn_id IN (
         SELECT burn_id FROM claims WHERE zcash_height > $1
       )`,
      [height],
    );
    await client.query(
      `UPDATE claims
       SET status='reserved',
           zcash_txid=NULL,
           zcash_height=NULL,
           zcash_tx_index=NULL,
           recipient_vout=NULL,
           carrier_vout=NULL,
           current_owner=NULL,
           owner_txid=NULL,
           owner_vout=NULL,
           ownership_state='tracked',
           error=NULL,
           updated_at=NOW()
       WHERE zcash_height > $1`,
      [height],
    );
    await client.query("DELETE FROM transfers WHERE zcash_height > $1", [height]);
    await client.query("DELETE FROM ownership_terminals WHERE zcash_height > $1", [height]);
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
  await rebuildOwnershipFromTransfers();
  return height;
}

function outputZats(vout: { valueZat?: number; value?: number }): bigint {
  if (vout.valueZat !== undefined) return BigInt(vout.valueZat);
  if (vout.value !== undefined) return BigInt(Math.round(vout.value * 100_000_000));
  return -1n;
}

function recipientMarkerVout(
  tx: { vout: Array<{ n: number; valueZat?: number; value?: number; scriptPubKey: { addresses?: string[] } }> },
  recipient: string,
): number | null {
  const matches = tx.vout.filter(
    (vout) =>
      (vout.scriptPubKey.addresses || []).includes(recipient) &&
      outputZats(vout) === markerZats(),
  );
  return matches.length === 1 ? matches[0].n : null;
}


function transferDestination(
  tx: { vout: Array<{ n: number; scriptPubKey: { addresses?: string[] } }> },
): { owner: string; vout: number } | null {
  const candidates = tx.vout
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((vout) => ({ vout: vout.n, addresses: vout.scriptPubKey.addresses || [] }))
    .filter((row) => row.addresses.length === 1 && /^t[13]/.test(row.addresses[0]));

  if (!candidates.length) return null;
  return { owner: candidates[0].addresses[0], vout: candidates[0].vout };
}

async function indexTransfers(
  tx: Awaited<ReturnType<typeof getZcashBlock>>["tx"][number],
  height: number,
  txIndex: number,
): Promise<void> {
  const explicit = findTransferPayloads(tx);

  for (const vin of tx.vin || []) {
    if (!vin.txid || vin.vout === undefined) continue;
    const claim = await getClaimByOwnerOutpoint(vin.txid, vin.vout);
    if (!claim) continue;

    const destination = transferDestination(tx);
    if (!destination) {
      await terminateIndexedOwnership({
        burnId: claim.burn_id,
        txid: tx.txid,
        zcashHeight: height,
        zcashTxIndex: txIndex,
        fromTxid: vin.txid,
        fromVout: vin.vout,
      });
      continue;
    }

    const matchingPayload = explicit.find((payload) => payload.burnId === claim.burn_id);
    await applyIndexedTransfer({
      burnId: claim.burn_id,
      txid: tx.txid,
      zcashHeight: height,
      zcashTxIndex: txIndex,
      fromTxid: vin.txid,
      fromVout: vin.vout,
      toOwner: destination.owner,
      toVout: destination.vout,
      payloadVout: matchingPayload?.vout ?? null,
    });
  }
}


async function verifyNftReveal(
  tx: Awaited<ReturnType<typeof getZcashBlock>>["tx"][number],
  burn: NonNullable<Awaited<ReturnType<typeof findBurnRawByCommitment>>>,
): Promise<boolean> {
  if ((tx.vin || []).length !== 1) return false;
  const vin = tx.vin[0];
  if (!vin.txid || vin.vout === undefined || !vin.scriptSig?.hex) return false;

  const reveal = parseInscriptionRevealScriptSig(vin.scriptSig.hex);
  if (!reveal || reveal.contentType !== ZAPP_NFT_CONTENT_TYPE) return false;

  const nft = parseNftContent(reveal.content);
  if (!nft) return false;
  if (
    nft.mint !== burn.mint ||
    nft.burn !== burn.signature ||
    nft.burnId !== burn.burnId ||
    nft.amt !== burn.amount.toString() ||
    nft.to !== burn.recipient
  ) {
    return false;
  }

  let previous;
  try {
    previous = await getZcashTransaction(vin.txid);
  } catch {
    return false;
  }
  const prevout = previous.vout.find((output) => output.n === vin.vout);
  if (!prevout) return false;

  const expectedCommitAddress = p2shAddressForRedeemScript(reveal.redeemScript);
  const addresses = prevout.scriptPubKey.addresses || [];
  if (!addresses.includes(expectedCommitAddress)) return false;

  return true;
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
    // ZApp's inscription ownership convention makes output 0 the carrying output.
    if (recipientVout !== 0) continue;

    const validation = validateProofAgainstBurn(proof, burn, burn.recipient);
    if (!validation.valid) continue;
    if (!(await verifyNftReveal(tx, burn))) continue;

    const confirmed = await confirmIndexedClaim({
      evidence: burn,
      payloadHex: carrier.payloadHex,
      zcashTxid: tx.txid,
      zcashHeight: height,
      zcashTxIndex: txIndex,
      recipientVout,
      carrierVout: carrier.vout,
    });
    if (confirmed) {
      await markNftIndexerVerified({
        burnId: burn.burnId,
        revealTxid: tx.txid,
        zcashHeight: height,
      });
    }
  }

  // Apply ownership transfers only after all claim candidates in the block have
  // had a chance to become canonical. Transactions remain processed in chain order.
  for (let txIndex = 0; txIndex < block.tx.length; txIndex += 1) {
    await indexTransfers(block.tx[txIndex], height, txIndex);
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
  const tip = await getZcashBlockCount();
  const configuredStart = process.env.ZAPP_ZCASH_START_HEIGHT?.trim();
  let startHeight: number;

  if (configuredStart) {
    startHeight = Number.parseInt(configuredStart, 10);
  } else {
    const state = await database().query<{ height: string }>(
      "SELECT height FROM indexer_state WHERE name=$1",
      [STATE],
    );
    const resumeHeight = state.rows[0] ? Number(state.rows[0].height) : tip;
    // A 1,000-block overlap gives fresh deployments and ordinary reorg recovery
    // a recent safety window without scanning Zcash from genesis.
    startHeight = Math.max(0, resumeHeight - 1000);
  }

  if (!Number.isSafeInteger(startHeight) || startHeight < 0) {
    throw new Error("Invalid ZAPP_ZCASH_START_HEIGHT");
  }

  const last = await reconcileReorg(startHeight);
  const confirmations = Math.max(
    1,
    Number.parseInt(process.env.ZCASH_MIN_CONFIRMATIONS || "1", 10),
  );
  const safeTip = tip - (confirmations - 1);

  for (
    let height = Math.max(startHeight, last + 1);
    height <= safeTip;
    height += 1
  ) {
    await indexBlock(height);
  }
}

async function main() {
  const watch = process.argv.includes("--watch");
  await heartbeatService("zcash-indexer", "starting", "initial chain reconciliation");
  do {
    await syncOnce();
    await heartbeatService("zcash-indexer", "ready", "canonical chain synced");
    if (!watch) break;
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  } while (true);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await heartbeatService(
      "zcash-indexer",
      "error",
      error instanceof Error ? error.message.slice(0, 500) : "indexer error",
    );
  } catch {}
  process.exit(1);
});
