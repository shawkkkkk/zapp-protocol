import {
  bytesToHex,
  decodeClaimPayload,
  decodeOpReturnScript,
  decodeTransferPayload,
  encodeClaimPayload,
  encodeOpReturnScript,
  encodeTransferPayload,
} from "../protocol.ts";
import { assertMainnetTransparentAddress } from "./crypto.ts";
import type { BurnEvidence } from "../validation.ts";

type RpcError = { code?: number; message?: string };

export class ZcashRpc {
  private readonly url: string;
  private readonly user: string | undefined;
  private readonly password: string | undefined;

  constructor(
    url = process.env.ZCASH_RPC_URL || "http://127.0.0.1:8232",
    user = process.env.ZCASH_RPC_USER,
    password = process.env.ZCASH_RPC_PASSWORD,
  ) {
    this.url = url;
    this.user = user;
    this.password = password;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.user || !this.password) throw new Error("Zcash RPC credentials are not configured");
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${this.user}:${this.password}`).toString("base64")}`,
      },
      body: JSON.stringify({ jsonrpc: "1.0", id: "zapp", method, params }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Zcash RPC HTTP ${response.status}`);
    const body = (await response.json()) as { result?: T; error?: RpcError | null };
    if (body.error) {
      throw new Error(`Zcash RPC ${method}: ${body.error.message || body.error.code || "unknown error"}`);
    }
    return body.result as T;
  }
}

type DecodedVout = {
  n: number;
  value?: number;
  valueZat?: number;
  scriptPubKey: {
    hex: string;
    type?: string;
    addresses?: string[];
  };
};

export type DecodedVin = {
  txid?: string;
  vout?: number;
  coinbase?: string;
};

export type DecodedTx = {
  txid: string;
  vin: DecodedVin[];
  vout: DecodedVout[];
};

function markerZats(): bigint {
  const value = BigInt(process.env.ZCASH_MARKER_ZATS || "546");
  if (value <= 0n || value > 100_000_000n) {
    throw new Error("ZCASH_MARKER_ZATS must be 1..100000000");
  }
  return value;
}

function compactSizeHex(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 253) {
    throw new Error("ZApp writer only supports compact-size values below 253");
  }
  return value.toString(16).padStart(2, "0");
}

/**
 * zcashd's final createrawtransaction RPC only accepts address outputs; it has
 * no Bitcoin-style {data: ...} output syntax. We therefore ask zcashd itself
 * to create a context-correct transaction with a unique zero-value P2SH
 * placeholder, replace that output script before funding/signing, and decode
 * the result again with zcashd. This avoids hand-rolling transaction versions,
 * branch IDs, expiry heights, inputs, fees, or signatures.
 */
export function replaceZeroValueOutputScript(
  transactionHex: string,
  oldScriptHex: string,
  newScriptHex: string,
): string {
  const oldBytes = oldScriptHex.length / 2;
  const newBytes = newScriptHex.length / 2;
  if (!Number.isInteger(oldBytes) || !Number.isInteger(newBytes)) {
    throw new Error("Output scripts must be whole bytes");
  }

  const zeroValue = "0000000000000000";
  const needle = `${zeroValue}${compactSizeHex(oldBytes)}${oldScriptHex}`.toLowerCase();
  const replacement = `${zeroValue}${compactSizeHex(newBytes)}${newScriptHex}`.toLowerCase();
  const tx = transactionHex.toLowerCase();

  const first = tx.indexOf(needle);
  if (first === -1) throw new Error("Could not locate the ZApp carrier placeholder output");
  if (tx.indexOf(needle, first + 1) !== -1) {
    throw new Error("Carrier placeholder is not unique; refusing to mutate transaction");
  }

  return tx.slice(0, first) + replacement + tx.slice(first + needle.length);
}

export function findClaimPayloads(decoded: DecodedTx): Array<{ vout: number; payloadHex: string }> {
  const found: Array<{ vout: number; payloadHex: string }> = [];
  for (const output of decoded.vout || []) {
    const data = decodeOpReturnScript(output.scriptPubKey.hex);
    if (!data) continue;
    try {
      decodeClaimPayload(data);
      found.push({ vout: output.n, payloadHex: bytesToHex(data) });
    } catch {
      // Not a ZApp proof.
    }
  }
  return found;
}


export function findTransferPayloads(decoded: DecodedTx): Array<{ vout: number; burnId: string; payloadHex: string }> {
  const found: Array<{ vout: number; burnId: string; payloadHex: string }> = [];
  for (const output of decoded.vout || []) {
    const data = decodeOpReturnScript(output.scriptPubKey.hex);
    if (!data) continue;
    try {
      const transfer = decodeTransferPayload(data);
      found.push({ vout: output.n, burnId: transfer.burnId, payloadHex: bytesToHex(data) });
    } catch {
      // Not a ZApp transfer.
    }
  }
  return found;
}

function assertTransactionCarriesProof(
  decoded: DecodedTx,
  evidence: BurnEvidence,
  payloadHex: string,
): { recipientVout: number; carrierVout: number } {
  const carriers = findClaimPayloads(decoded).filter((item) => item.payloadHex === payloadHex);
  if (carriers.length !== 1) {
    throw new Error("Prepared Zcash transaction must contain exactly one matching ZApp Proof");
  }

  const targetZats = markerZats();
  const recipients = decoded.vout.filter((output) => {
    const addresses = output.scriptPubKey.addresses || [];
    return addresses.includes(evidence.recipient) && BigInt(output.valueZat ?? -1) === targetZats;
  });
  if (recipients.length !== 1) {
    throw new Error("Prepared Zcash transaction must contain exactly one marker output to the committed recipient");
  }

  return { recipientVout: recipients[0].n, carrierVout: carriers[0].vout };
}

async function buildUnfundedProofTransaction(
  rpc: ZcashRpc,
  evidence: BurnEvidence,
  payloadHex: string,
): Promise<string> {
  // OP_TRUE is deterministic and decodescript gives us a valid P2SH address
  // for the active network. It is only a temporary zero-value output.
  const placeholder = await rpc.call<{ p2sh?: string }>("decodescript", ["51"]);
  if (!placeholder.p2sh) throw new Error("Zcash node did not return a P2SH placeholder address");

  const markerZec = Number(markerZats()) / 100_000_000;
  const rawWithPlaceholder = await rpc.call<string>("createrawtransaction", [
    [],
    {
      [evidence.recipient]: markerZec,
      [placeholder.p2sh]: 0,
    },
  ]);

  const decodedPlaceholder = await rpc.call<DecodedTx>("decoderawtransaction", [rawWithPlaceholder]);
  const placeholderOutputs = decodedPlaceholder.vout.filter(
    (output) =>
      (output.scriptPubKey.addresses || []).includes(placeholder.p2sh as string) &&
      BigInt(output.valueZat ?? -1) === 0n,
  );
  if (placeholderOutputs.length !== 1) {
    throw new Error("Zcash writer could not create a unique carrier placeholder");
  }

  const opReturnScriptHex = bytesToHex(
    encodeOpReturnScript(Uint8Array.from(Buffer.from(payloadHex, "hex"))),
  );
  const mutated = replaceZeroValueOutputScript(
    rawWithPlaceholder,
    placeholderOutputs[0].scriptPubKey.hex,
    opReturnScriptHex,
  );

  // Make the node parse our mutation before it ever reaches a wallet/funder.
  const decodedMutated = await rpc.call<DecodedTx>("decoderawtransaction", [mutated]);
  assertTransactionCarriesProof(decodedMutated, evidence, payloadHex);
  return mutated;
}

export async function broadcastProof(
  evidence: BurnEvidence,
  rpc = new ZcashRpc(),
): Promise<{ txid: string; payloadHex: string; recipientVout: number; carrierVout: number }> {
  assertMainnetTransparentAddress(evidence.recipient);

  const chain = await rpc.call<{ chain?: string }>("getblockchaininfo");
  if (chain.chain && chain.chain !== "main") {
    throw new Error(`Refusing to broadcast a mainnet ZApp Proof on chain ${chain.chain}`);
  }

  const payload = encodeClaimPayload({
    mint: evidence.mint,
    burnId: evidence.burnId,
    amount: evidence.amount,
  });
  const payloadHex = bytesToHex(payload);

  const unfunded = await buildUnfundedProofTransaction(rpc, evidence, payloadHex);
  const funded = await rpc.call<{ hex: string }>("fundrawtransaction", [unfunded]);
  const decodedFunded = await rpc.call<DecodedTx>("decoderawtransaction", [funded.hex]);
  const positions = assertTransactionCarriesProof(decodedFunded, evidence, payloadHex);

  const signed = await rpc.call<{ hex: string; complete: boolean; errors?: unknown[] }>(
    "signrawtransaction",
    [funded.hex],
  );
  if (!signed.complete) {
    throw new Error(
      `Zcash wallet could not fully sign transaction: ${JSON.stringify(signed.errors || [])}`,
    );
  }

  const decodedSigned = await rpc.call<DecodedTx>("decoderawtransaction", [signed.hex]);
  assertTransactionCarriesProof(decodedSigned, evidence, payloadHex);

  const txid = await rpc.call<string>("sendrawtransaction", [signed.hex, false]);
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    throw new Error("Zcash node returned an invalid transaction id");
  }

  return { txid, payloadHex, ...positions };
}


function assertTransactionCarriesTransfer(
  decoded: DecodedTx,
  input: { burnId: string; fromTxid: string; fromVout: number; toOwner: string; payloadHex: string },
): { recipientVout: number; carrierVout: number } {
  const carriers = findTransferPayloads(decoded).filter(
    (item) => item.burnId === input.burnId && item.payloadHex === input.payloadHex,
  );
  if (carriers.length !== 1) throw new Error("Transfer must contain exactly one matching ZApp transfer payload");

  const spendsMarker = (decoded.vin || []).some(
    (vin) => vin.txid === input.fromTxid && vin.vout === input.fromVout,
  );
  if (!spendsMarker) throw new Error("Transfer no longer spends the current ZApp marker output");

  const recipients = decoded.vout.filter(
    (output) =>
      (output.scriptPubKey.addresses || []).includes(input.toOwner) &&
      BigInt(output.valueZat ?? -1) === markerZats(),
  );
  if (recipients.length !== 1) throw new Error("Transfer must create exactly one marker output for the new owner");
  return { recipientVout: recipients[0].n, carrierVout: carriers[0].vout };
}

export async function broadcastTransfer(
  input: { burnId: string; fromTxid: string; fromVout: number; toOwner: string },
  rpc = new ZcashRpc(),
): Promise<{ txid: string; payloadHex: string; recipientVout: number; carrierVout: number }> {
  assertMainnetTransparentAddress(input.toOwner);
  if (!/^[0-9a-f]{64}$/i.test(input.burnId) || !/^[0-9a-f]{64}$/i.test(input.fromTxid)) {
    throw new Error("Invalid ZApp transfer identifiers");
  }

  const chain = await rpc.call<{ chain?: string }>("getblockchaininfo");
  if (chain.chain && chain.chain !== "main") throw new Error("Refusing to transfer a mainnet ZApp Proof off mainnet");

  const payloadHex = bytesToHex(encodeTransferPayload({ burnId: input.burnId }));
  const placeholder = await rpc.call<{ p2sh?: string }>("decodescript", ["51"]);
  if (!placeholder.p2sh) throw new Error("Zcash node did not return a carrier placeholder");

  const markerZec = Number(markerZats()) / 100_000_000;
  const raw = await rpc.call<string>("createrawtransaction", [
    [{ txid: input.fromTxid, vout: input.fromVout }],
    { [input.toOwner]: markerZec, [placeholder.p2sh]: 0 },
  ]);

  const decodedPlaceholder = await rpc.call<DecodedTx>("decoderawtransaction", [raw]);
  const placeholderOutputs = decodedPlaceholder.vout.filter(
    (output) =>
      (output.scriptPubKey.addresses || []).includes(placeholder.p2sh as string) &&
      BigInt(output.valueZat ?? -1) === 0n,
  );
  if (placeholderOutputs.length !== 1) throw new Error("Transfer carrier placeholder is not unique");

  const scriptHex = bytesToHex(
    encodeOpReturnScript(Uint8Array.from(Buffer.from(payloadHex, "hex"))),
  );
  const mutated = replaceZeroValueOutputScript(
    raw,
    placeholderOutputs[0].scriptPubKey.hex,
    scriptHex,
  );
  assertTransactionCarriesTransfer(
    await rpc.call<DecodedTx>("decoderawtransaction", [mutated]),
    { ...input, payloadHex },
  );

  const funded = await rpc.call<{ hex: string }>("fundrawtransaction", [mutated]);
  const positions = assertTransactionCarriesTransfer(
    await rpc.call<DecodedTx>("decoderawtransaction", [funded.hex]),
    { ...input, payloadHex },
  );

  const signed = await rpc.call<{ hex: string; complete: boolean; errors?: unknown[] }>(
    "signrawtransaction",
    [funded.hex],
  );
  if (!signed.complete) throw new Error("Wallet cannot sign the current Proof marker input");
  assertTransactionCarriesTransfer(
    await rpc.call<DecodedTx>("decoderawtransaction", [signed.hex]),
    { ...input, payloadHex },
  );

  const txid = await rpc.call<string>("sendrawtransaction", [signed.hex, false]);
  if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error("Zcash node returned an invalid transfer txid");
  return { txid, payloadHex, ...positions };
}

export async function getZcashBlockCount(rpc = new ZcashRpc()): Promise<number> {
  return rpc.call<number>("getblockcount");
}

export async function getZcashBlockHash(height: number, rpc = new ZcashRpc()): Promise<string> {
  return rpc.call<string>("getblockhash", [height]);
}

export async function getZcashBlock(
  heightOrHash: number | string,
  rpc = new ZcashRpc(),
): Promise<{ hash: string; height: number; tx: DecodedTx[] }> {
  return rpc.call("getblock", [String(heightOrHash), 2]);
}
