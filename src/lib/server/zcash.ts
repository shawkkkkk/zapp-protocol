import { bytesToHex, decodeClaimPayload, decodeOpReturnScript, encodeClaimPayload } from "../protocol.ts";
import { assertMainnetTransparentAddress } from "./crypto.ts";
import type { BurnEvidence } from "../validation.ts";

type RpcError = { code?: number; message?: string };

export class ZcashRpc {
  constructor(
    private readonly url = process.env.ZCASH_RPC_URL || "http://127.0.0.1:8232",
    private readonly user = process.env.ZCASH_RPC_USER,
    private readonly password = process.env.ZCASH_RPC_PASSWORD,
  ) {}

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
    if (body.error) throw new Error(`Zcash RPC ${method}: ${body.error.message || body.error.code || "unknown error"}`);
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

type DecodedTx = {
  txid: string;
  vout: DecodedVout[];
};

function markerZats(): bigint {
  const value = BigInt(process.env.ZCASH_MARKER_ZATS || "1000");
  if (value <= 0n || value > 100_000_000n) throw new Error("ZCASH_MARKER_ZATS must be 1..100000000");
  return value;
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
      // Not a ZApp claim.
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
  if (carriers.length !== 1) throw new Error("Prepared Zcash transaction must contain exactly one matching ZApp Proof");

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

export async function broadcastProof(
  evidence: BurnEvidence,
  rpc = new ZcashRpc(),
): Promise<{ txid: string; payloadHex: string; recipientVout: number; carrierVout: number }> {
  assertMainnetTransparentAddress(evidence.recipient);

  const chain = await rpc.call<{ chain?: string }>("getblockchaininfo");
  if (chain.chain && chain.chain !== "main") throw new Error(`Refusing to broadcast a mainnet ZApp Proof on chain ${chain.chain}`);

  const address = await rpc.call<{ isvalid: boolean; address_type?: string }>("z_validateaddress", [evidence.recipient]);
  if (!address.isvalid || !["p2pkh", "p2sh"].includes(address.address_type || "")) {
    throw new Error("Destination is not a valid transparent Zcash mainnet address");
  }

  const payload = encodeClaimPayload({
    mint: evidence.mint,
    burnId: evidence.burnId,
    amount: evidence.amount,
  });
  const payloadHex = bytesToHex(payload);
  const zecValue = Number(markerZats()) / 100_000_000;

  const raw = await rpc.call<string>("createrawtransaction", [
    [],
    { [evidence.recipient]: zecValue, data: payloadHex },
  ]);
  const funded = await rpc.call<{ hex: string }>("fundrawtransaction", [raw, false]);
  const decodedFunded = await rpc.call<DecodedTx>("decoderawtransaction", [funded.hex]);
  const positions = assertTransactionCarriesProof(decodedFunded, evidence, payloadHex);

  const signed = await rpc.call<{ hex: string; complete: boolean; errors?: unknown[] }>("signrawtransaction", [funded.hex]);
  if (!signed.complete) throw new Error(`Zcash wallet could not fully sign transaction: ${JSON.stringify(signed.errors || [])}`);

  const decodedSigned = await rpc.call<DecodedTx>("decoderawtransaction", [signed.hex]);
  assertTransactionCarriesProof(decodedSigned, evidence, payloadHex);

  const txid = await rpc.call<string>("sendrawtransaction", [signed.hex, false]);
  if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error("Zcash node returned an invalid transaction id");
  return { txid, payloadHex, ...positions };
}

export async function getZcashBlockCount(rpc = new ZcashRpc()): Promise<number> {
  return rpc.call<number>("getblockcount");
}

export async function getZcashBlockHash(height: number, rpc = new ZcashRpc()): Promise<string> {
  return rpc.call<string>("getblockhash", [height]);
}

export async function getZcashBlock(heightOrHash: number | string, rpc = new ZcashRpc()): Promise<{
  hash: string;
  height: number;
  tx: DecodedTx[];
}> {
  return rpc.call("getblock", [String(heightOrHash), 2]);
}
