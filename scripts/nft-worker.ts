import { spawn } from "node:child_process";
import {
  acquireClaimRelay,
  acquireNextNftMint,
  getClaim,
  markClaimBroadcast,
  markClaimFailed,
  updateNftMint,
  heartbeatService,
} from "../src/lib/server/db.ts";
import {
  inscriptionDescriptor,
  estimateRevealZip317FeeZats,
} from "../src/lib/inscription.ts";
import { parseNftContent } from "../src/lib/nft.ts";
import { bytesToHex, encodeOpReturnScript, hexToBytes } from "../src/lib/protocol.ts";
import {
  findClaimPayloads,
  replaceZeroValueOutputScript,
  ZcashRpc,
  type DecodedTx,
} from "../src/lib/server/zcash.ts";

const MARKER_ZATS = BigInt(process.env.ZCASH_MARKER_ZATS || "546");
const POSTAGE_ZATS = BigInt(process.env.ZAPP_NFT_POSTAGE_ZATS || MARKER_ZATS.toString());
const MIN_REVEAL_FEE_ZATS = BigInt(process.env.ZAPP_NFT_REVEAL_FEE_ZATS || "0");

if (POSTAGE_ZATS !== MARKER_ZATS) {
  throw new Error("ZAPP_NFT_POSTAGE_ZATS must equal ZCASH_MARKER_ZATS");
}
const SIGNER_BIN =
  process.env.ZAPP_INSCRIPTION_SIGNER_BIN ||
  "native/zapp-zcash-signer/target/release/zapp-zcash-signer";


async function selfTestSigner(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(SIGNER_BIN, ["--self-test"], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("Inscription signer self-test failed: " + Buffer.concat(stderr).toString("utf8").slice(0, 1000)));
        return;
      }
      try {
        const body = JSON.parse(Buffer.concat(stdout).toString("utf8")) as { ok?: boolean };
        if (body.ok !== true) throw new Error("signer did not report ok");
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

function zec(zats: bigint): number {
  if (zats < 0n || zats > 100_000_000n) throw new Error("Unexpected worker ZEC amount");
  return Number(zats) / 100_000_000;
}

function outputZats(output: { value?: number; valueZat?: number }): bigint {
  if (output.valueZat !== undefined) return BigInt(output.valueZat);
  if (output.value !== undefined) return BigInt(Math.round(output.value * 100_000_000));
  throw new Error("Decoded output has no value");
}

async function runSigner(input: Record<string, unknown>): Promise<{
  signed_tx_hex: string;
  script_sig_hex: string;
  signature_hex: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(SIGNER_BIN, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("Zcash signer failed: " + Buffer.concat(stderr).toString("utf8").slice(0, 2000)));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(JSON.stringify(input));
  });
}

async function waitWalletConfirmation(rpc: ZcashRpc, txid: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const tx = await rpc.call<{ confirmations?: number }>("gettransaction", [txid]);
      if ((tx.confirmations || 0) >= 1) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Commit transaction did not confirm in the expected window");
}

async function waitChainConfirmation(rpc: ZcashRpc, txid: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const tx = await rpc.call<{ confirmations?: number }>("getrawtransaction", [txid, 1]);
      if ((tx.confirmations || 0) >= 1) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Reveal transaction did not confirm in the expected window");
}

async function rebroadcast(rpc: ZcashRpc, rawHex: string, expectedTxid: string): Promise<void> {
  try {
    const txid = await rpc.call<string>("sendrawtransaction", [rawHex, false]);
    if (txid !== expectedTxid) throw new Error("Node returned a different transaction id");
  } catch (error) {
    try {
      const decoded = await rpc.call<{ txid: string }>("getrawtransaction", [expectedTxid, 1]);
      if (decoded.txid === expectedTxid) return;
    } catch {
      throw error;
    }
  }
}

async function signerKey(rpc: ZcashRpc): Promise<{ pubkey: string; wif: string }> {
  const address = process.env.ZAPP_NFT_SIGNER_TADDR;
  if (!address) throw new Error("ZAPP_NFT_SIGNER_TADDR is required");
  const info = await rpc.call<{
    isvalid: boolean;
    ismine?: boolean;
    isscript?: boolean;
    pubkey?: string;
  }>("validateaddress", [address]);
  if (!info.isvalid || !info.ismine || info.isscript || !info.pubkey) {
    throw new Error("ZAPP_NFT_SIGNER_TADDR must be a wallet-owned compressed t1 address");
  }
  if (!/^[0-9a-f]{66}$/i.test(info.pubkey)) throw new Error("NFT signer must use a compressed public key");
  const wif = await rpc.call<string>("dumpprivkey", [address]);
  return { pubkey: info.pubkey, wif };
}

function assertNftMatchesClaim(
  contentBytes: Uint8Array,
  claim: NonNullable<Awaited<ReturnType<typeof getClaim>>>,
): void {
  const nft = parseNftContent(contentBytes);
  if (!nft) throw new Error("Queued NFT content is not canonical");
  if (
    nft.mint !== claim.mint ||
    nft.burn !== claim.solana_signature ||
    nft.burnId !== claim.burn_id ||
    nft.amt !== claim.amount_base_units ||
    nft.to !== claim.recipient
  ) {
    throw new Error("Queued NFT content does not match the canonical burn claim");
  }
}

async function processOne(): Promise<boolean> {
  const job = await acquireNextNftMint();
  if (!job) return false;

  const claim = await getClaim(job.burn_id);
  if (!claim) {
    await updateNftMint(job.burn_id, { status: "failed", error: "Claim row is missing" });
    return true;
  }

  let relayAcquired = claim.status === "broadcast" || claim.status === "confirmed";
  if (!relayAcquired) relayAcquired = await acquireClaimRelay(job.burn_id);
  if (!relayAcquired) {
    await updateNftMint(job.burn_id, { status: "queued", error: null });
    return true;
  }

  const rpc = new ZcashRpc();

  try {
    const chain = await rpc.call<{ chain?: string }>("getblockchaininfo");
    if (chain.chain && chain.chain !== "main") throw new Error("NFT worker refuses non-mainnet Zcash RPC");

    const contentBytes = new TextEncoder().encode(job.content_json);
    assertNftMatchesClaim(contentBytes, claim);

    const signer = await signerKey(rpc);
    const descriptor = inscriptionDescriptor({
      compressedPubkeyHex: signer.pubkey,
      content: contentBytes,
    });

    const proofScript = bytesToHex(
      encodeOpReturnScript(hexToBytes(claim.payload_hex)),
    );
    const conventionalRevealFee = estimateRevealZip317FeeZats({
      content: contentBytes,
      redeemScriptHex: descriptor.redeemScriptHex,
      proofScriptHex: proofScript,
      contentType: "application/json",
    });
    const revealFee =
      conventionalRevealFee > MIN_REVEAL_FEE_ZATS
        ? conventionalRevealFee
        : MIN_REVEAL_FEE_ZATS;
    const commitValue = POSTAGE_ZATS + revealFee;
    let commitTxid = job.commit_txid;
    let commitVout = job.commit_vout;
    let commitRawHex = job.commit_raw_hex;

    if (!commitTxid || commitVout === null || !commitRawHex) {
      const raw = await rpc.call<string>("createrawtransaction", [
        [],
        { [descriptor.commitAddress]: zec(commitValue) },
      ]);
      const funded = await rpc.call<{ hex: string }>("fundrawtransaction", [raw]);
      const signed = await rpc.call<{ hex: string; complete: boolean }>("signrawtransaction", [funded.hex]);
      if (!signed.complete) throw new Error("Wallet could not sign inscription commit");

      const decoded = await rpc.call<DecodedTx>("decoderawtransaction", [signed.hex]);
      const outputs = decoded.vout.filter(
        (output) =>
          (output.scriptPubKey.addresses || []).includes(descriptor.commitAddress) &&
          outputZats(output) === commitValue,
      );
      if (outputs.length !== 1) throw new Error("Commit transaction does not contain the expected P2SH output");

      commitTxid = decoded.txid;
      commitVout = outputs[0].n;
      commitRawHex = signed.hex;
      await updateNftMint(job.burn_id, {
        status: "commit_broadcast",
        commitTxid,
        commitVout,
        commitRawHex,
        error: null,
      });
    }

    await rebroadcast(rpc, commitRawHex, commitTxid);
    await waitWalletConfirmation(rpc, commitTxid);

    if (job.reveal_txid && job.reveal_raw_hex) {
      const recoveredReveal = await rpc.call<DecodedTx>(
        "decoderawtransaction",
        [job.reveal_raw_hex],
      );
      if (recoveredReveal.txid !== job.reveal_txid) {
        throw new Error("Persisted reveal raw transaction id does not match stored txid");
      }
      const recoveredCarrier = findClaimPayloads(recoveredReveal);
      if (
        recoveredCarrier.length !== 1 ||
        recoveredCarrier[0].payloadHex !== claim.payload_hex
      ) {
        throw new Error("Persisted reveal does not contain the canonical ZApp proof");
      }
      const recoveredRecipient = recoveredReveal.vout.find(
        (output) =>
          output.n === 0 &&
          (output.scriptPubKey.addresses || []).includes(claim.recipient) &&
          outputZats(output) === POSTAGE_ZATS,
      );
      if (!recoveredRecipient) {
        throw new Error("Persisted reveal does not pay the committed recipient at vout 0");
      }

      await rebroadcast(rpc, job.reveal_raw_hex, job.reveal_txid);
      await markClaimBroadcast({
        burnId: claim.burn_id,
        txid: job.reveal_txid,
        recipientVout: 0,
        carrierVout: recoveredCarrier[0].vout,
      });
      await waitChainConfirmation(rpc, job.reveal_txid);
      await updateNftMint(job.burn_id, {
        status: "confirmed",
        revealTxid: job.reveal_txid,
        revealRawHex: job.reveal_raw_hex,
        inscriptionId: job.inscription_id || job.reveal_txid + "i0",
        error: null,
      });
      return true;
    }

    const placeholder = await rpc.call<{ p2sh?: string }>("decodescript", ["51"]);
    if (!placeholder.p2sh) throw new Error("Node did not return a reveal carrier placeholder");

    const rawReveal = await rpc.call<string>("createrawtransaction", [
      [{ txid: commitTxid, vout: commitVout }],
      { [claim.recipient]: zec(POSTAGE_ZATS), [placeholder.p2sh]: 0 },
    ]);
    const decodedPlaceholder = await rpc.call<DecodedTx>("decoderawtransaction", [rawReveal]);
    const placeholderOutputs = decodedPlaceholder.vout.filter(
      (output) =>
        (output.scriptPubKey.addresses || []).includes(placeholder.p2sh as string) &&
        outputZats(output) === 0n,
    );
    if (placeholderOutputs.length !== 1) throw new Error("Reveal proof placeholder is not unique");

    const revealWithProof = replaceZeroValueOutputScript(
      rawReveal,
      placeholderOutputs[0].scriptPubKey.hex,
      proofScript,
    );
    const unsignedDecoded = await rpc.call<DecodedTx>("decoderawtransaction", [revealWithProof]);
    const recipient = unsignedDecoded.vout.find(
      (output) =>
        output.n === 0 &&
        (output.scriptPubKey.addresses || []).includes(claim.recipient) &&
        outputZats(output) === POSTAGE_ZATS,
    );
    if (!recipient) throw new Error("Reveal output 0 is not the committed Zcash recipient");
    const carrier = findClaimPayloads(unsignedDecoded);
    if (carrier.length !== 1 || carrier[0].payloadHex !== claim.payload_hex) {
      throw new Error("Reveal does not contain the canonical ZApp proof");
    }

    const commitDecoded = await rpc.call<DecodedTx>("decoderawtransaction", [commitRawHex]);
    const prevScript = commitDecoded.vout[commitVout]?.scriptPubKey.hex;
    if (!prevScript) throw new Error("Commit output script is unavailable");

    const signedReveal = await runSigner({
      raw_tx_hex: revealWithProof,
      prev_script_pubkey_hex: prevScript,
      prev_value_zats: commitValue.toString(),
      redeem_script_hex: descriptor.redeemScriptHex,
      content_hex: Buffer.from(contentBytes).toString("hex"),
      content_type: "application/json",
      wif: signer.wif,
      expected_pubkey_hex: signer.pubkey,
    });

    const signedDecoded = await rpc.call<DecodedTx>("decoderawtransaction", [signedReveal.signed_tx_hex]);
    const signedCarrier = findClaimPayloads(signedDecoded);
    if (signedCarrier.length !== 1 || signedCarrier[0].payloadHex !== claim.payload_hex) {
      throw new Error("Signed reveal lost the ZApp proof carrier");
    }
    const signedRecipient = signedDecoded.vout.find(
      (output) =>
        output.n === 0 &&
        (output.scriptPubKey.addresses || []).includes(claim.recipient) &&
        outputZats(output) === POSTAGE_ZATS,
    );
    if (!signedRecipient) throw new Error("Signed reveal changed the NFT destination");

    const revealTxid = signedDecoded.txid;
    const inscriptionId = revealTxid + "i0";
    await updateNftMint(job.burn_id, {
      status: "reveal_broadcast",
      commitTxid,
      commitVout,
      commitRawHex,
      revealTxid,
      revealRawHex: signedReveal.signed_tx_hex,
      inscriptionId,
      error: null,
    });

    await rebroadcast(rpc, signedReveal.signed_tx_hex, revealTxid);
    await markClaimBroadcast({
      burnId: claim.burn_id,
      txid: revealTxid,
      recipientVout: 0,
      carrierVout: signedCarrier[0].vout,
    });
    await waitChainConfirmation(rpc, revealTxid);
    await updateNftMint(job.burn_id, {
      status: "confirmed",
      revealTxid,
      revealRawHex: signedReveal.signed_tx_hex,
      inscriptionId,
      error: null,
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "NFT worker failed";
    await updateNftMint(job.burn_id, { status: "failed", error: message.slice(0, 2000) });
    if (relayAcquired && claim.status !== "broadcast" && claim.status !== "confirmed") {
      await markClaimFailed(job.burn_id, message);
    }
    throw error;
  }
}

async function main() {
  await selfTestSigner();
  await heartbeatService("nft-worker", "ready", "signer self-test passed");
  console.log("ZApp NFT worker ready: signer self-test passed, queue polling active");
  let lastLogAt = Date.now();
  const watch = process.argv.includes("--watch");
  do {
    try {
      if (process.env.ZAPP_NFT_MINT_ENABLED === "false") {
        await heartbeatService("nft-worker", "paused", "NFT mint kill switch is off");
        if (!watch) break;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }

      const worked = await processOne();
      await heartbeatService("nft-worker", "ready", worked ? "processed queue item" : "idle");
      if (worked) {
        console.log("ZApp NFT worker processed a queue item");
        lastLogAt = Date.now();
      } else if (Date.now() - lastLogAt >= 30_000) {
        console.log("ZApp NFT worker heartbeat: ready, queue idle");
        lastLogAt = Date.now();
      }
      if (!watch) break;
      if (!worked) await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (error) {
      console.error(error);
      try {
        await heartbeatService(
          "nft-worker",
          "error",
          error instanceof Error ? error.message.slice(0, 500) : "worker error",
        );
      } catch {}
      if (!watch) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } while (true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
