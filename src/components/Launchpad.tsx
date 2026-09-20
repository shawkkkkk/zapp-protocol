"use client";

import { useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  browserSolanaRpc,
  buildBurnAndProofTransaction,
  buildFixedSupplyMintTransaction,
  getInjectedWallet,
} from "@/lib/client/solana";

type Stage = "idle" | "signing" | "finalizing" | "anchoring" | "done";

async function waitForFinalized(signature: string): Promise<void> {
  const connection = new Connection(browserSolanaRpc(), "confirmed");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = result.value[0];
    if (status?.err) throw new Error("Solana transaction failed");
    if (status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Solana transaction was not finalized in the expected window. You can retry the proof step with the same signature.");
}

export function Launchpad() {
  const [wallet, setWallet] = useState<string>("");
  const [mint, setMint] = useState("");
  const [amount, setAmount] = useState("");
  const [zcashAddress, setZcashAddress] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ solana?: string; zcash?: string; burnId?: string }>({});
  const [createSupply, setCreateSupply] = useState("1000000000");
  const [createDecimals, setCreateDecimals] = useState("6");
  const [createdMint, setCreatedMint] = useState("");

  async function connect() {
    const provider = getInjectedWallet();
    if (!provider) throw new Error("No injected Solana wallet found. Install a compatible wallet such as Phantom.");
    const connected = await provider.connect();
    setWallet(connected.publicKey.toBase58());
  }

  async function migrate() {
    setMessage("");
    setResult({});
    try {
      const provider = getInjectedWallet();
      if (!provider) throw new Error("No injected Solana wallet found");
      const connected = provider.publicKey ? { publicKey: provider.publicKey } : await provider.connect();
      setWallet(connected.publicKey.toBase58());

      setStage("signing");
      const built = await buildBurnAndProofTransaction({
        owner: connected.publicKey,
        mint,
        amountUi: amount,
        zcashAddress,
      });
      const sent = await provider.signAndSendTransaction(built.transaction);
      setResult({ solana: sent.signature });

      setStage("finalizing");
      await waitForFinalized(sent.signature);

      setStage("anchoring");
      const response = await fetch("/api/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ solanaSignature: sent.signature }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Zcash proof relay failed");

      setResult({
        solana: sent.signature,
        zcash: json.claim?.zcashTxid,
        burnId: json.proof?.burnId || json.claim?.burnId,
      });
      setStage("done");
    } catch (error) {
      setStage("idle");
      setMessage(error instanceof Error ? error.message : "Migration failed");
    }
  }

  async function createToken() {
    setMessage("");
    try {
      const provider = getInjectedWallet();
      if (!provider) throw new Error("No injected Solana wallet found");
      const connected = provider.publicKey ? { publicKey: provider.publicKey } : await provider.connect();
      setWallet(connected.publicKey.toBase58());

      const built = await buildFixedSupplyMintTransaction({
        owner: connected.publicKey,
        supplyUi: createSupply,
        decimals: Number.parseInt(createDecimals, 10),
      });
      const sent = await provider.signAndSendTransaction(built.transaction);
      await waitForFinalized(sent.signature);
      setCreatedMint(built.mint);
      setMint(built.mint);
      setMessage("Fixed-supply SPL mint created and mint authority revoked. It is ready for ZApp burns.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Token creation failed");
    }
  }

  const buttonText =
    stage === "signing" ? "Sign burn" :
    stage === "finalizing" ? "Waiting for Solana finality" :
    stage === "anchoring" ? "Anchoring proof to Zcash" :
    stage === "done" ? "Proof broadcast" :
    "Burn & prove";

  return (
    <section className="launchwrap shell">
      <div className="launchcard">
        <div className="launch-top">
          <div>
            <div className="eyebrow">ZAPP LAUNCHPAD</div>
            <h2>Burn → Prove</h2>
          </div>
          <button className="wallet" onClick={() => connect().catch((e) => setMessage(e.message))}>
            {wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "Connect Solana"}
          </button>
        </div>

        <label>
          <span>Solana mint</span>
          <input value={mint} onChange={(e) => setMint(e.target.value.trim())} placeholder="Mint address" />
        </label>
        <label>
          <span>Amount to destroy</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000000" inputMode="decimal" />
        </label>
        <label>
          <span>Zcash mainnet destination</span>
          <input value={zcashAddress} onChange={(e) => setZcashAddress(e.target.value.trim())} placeholder="t1… or t3…" />
          <small>ZApp v1 uses a transparent address because the proof and destination must be publicly verifiable.</small>
        </label>

        <button
          className="primary"
          disabled={stage !== "idle" && stage !== "done"}
          onClick={migrate}
        >
          {buttonText}
        </button>

        {message && <div className="notice">{message}</div>}
        {(result.solana || result.zcash) && (
          <div className="resultbox">
            {result.solana && <div><b>Solana burn</b><code>{result.solana}</code></div>}
            {result.zcash && <div><b>Zcash tx</b><code>{result.zcash}</code></div>}
            {result.burnId && <div><b>ZApp Proof ID</b><code>{result.burnId}</code></div>}
          </div>
        )}
      </div>

      <aside className="createcard">
        <div className="eyebrow">START FROM ZERO</div>
        <h3>Create a fixed-supply SPL token</h3>
        <p>This minimal creator mints the full supply to you and permanently revokes mint authority in the same transaction.</p>
        <label>
          <span>Total supply</span>
          <input value={createSupply} onChange={(e) => setCreateSupply(e.target.value)} inputMode="decimal" />
        </label>
        <label>
          <span>Decimals</span>
          <input value={createDecimals} onChange={(e) => setCreateDecimals(e.target.value)} inputMode="numeric" />
        </label>
        <button className="secondary" onClick={createToken}>Create SPL mint</button>
        {createdMint && <code className="mintcode">{createdMint}</code>}
        <small>Metadata creation is intentionally separate from protocol validity. A name or image can never create ZApp supply.</small>
      </aside>
    </section>
  );
}
