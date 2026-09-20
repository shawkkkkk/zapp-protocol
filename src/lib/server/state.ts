import { createHash } from "node:crypto";
import { database } from "./db.ts";

export type CanonicalState = {
  height: number | null;
  blockHash: string | null;
  proofCount: number;
  totalsByMint: Record<string, string>;
  root: string;
};

export async function canonicalState(): Promise<CanonicalState> {
  const db = database();
  const state = await db.query<{ height: string; block_hash: string }>(
    "SELECT height, block_hash FROM indexer_state WHERE name='zcash-mainnet-v1'",
  );
  const rows = await db.query<{
    burn_id: string;
    mint: string;
    amount_base_units: string;
    current_owner: string | null;
    owner_txid: string | null;
    owner_vout: number | null;
  }>(
    `SELECT burn_id,mint,amount_base_units,current_owner,owner_txid,owner_vout
     FROM claims
     WHERE status='confirmed'
     ORDER BY burn_id ASC`,
  );

  const totals = new Map<string, bigint>();
  const hasher = createHash("sha256");
  hasher.update("ZAPP_STATE_V1\n");
  for (const row of rows.rows) {
    totals.set(row.mint, (totals.get(row.mint) || 0n) + BigInt(row.amount_base_units));
    hasher.update(
      [
        row.burn_id,
        row.mint,
        row.amount_base_units,
        row.current_owner || "",
        row.owner_txid || "",
        row.owner_vout === null ? "" : String(row.owner_vout),
      ].join("|") + "\n",
    );
  }

  return {
    height: state.rows[0] ? Number(state.rows[0].height) : null,
    blockHash: state.rows[0]?.block_hash || null,
    proofCount: rows.rowCount || 0,
    totalsByMint: Object.fromEntries(
      [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mint, amount]) => [mint, amount.toString()]),
    ),
    root: hasher.digest("hex"),
  };
}
