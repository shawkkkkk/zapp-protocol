"use client";

import { useState } from "react";
import { Connection } from "@solana/web3.js";
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
  throw new Error("Solana transaction was not finalized in the expected window. Retry with the same signature.");
}

export function Launchpad({
  initialMint = "",
  initialSymbol = "",
  hideCreator = false,
}: {
  initialMint?: string;
  initialSymbol?: string;
  hideCreator?: boolean;
}) {
  const [wallet, setWallet] = useState("");
  const [mint, setMint] = useState(initialMint);
  const [amount, setAmount] = useState("");
  const [zcashAddress, setZcashAddress] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ solana?: string; zcash?: string; burnId?: string; nft?: string }>({});

  const [createSupply, setCreateSupply] = useState("1000000000");
  const [createDecimals, setCreateDecimals] = useState("6");
  const [launchName, setLaunchName] = useState("");
  const [launchSymbol, setLaunchSymbol] = useState("");
  const [launchImage, setLaunchImage] = useState("");
  const [launchDescription, setLaunchDescription] = useState("");
  const [createdMint, setCreatedMint] = useState("");

  async function connect() {
    const provider = getInjectedWallet();
    if (!provider) throw new Error("No injected Solana wallet found. Install a compatible wallet such as Phantom.");
    const connected = await provider.connect();
    setWallet(connected.publicKey.toBase58());
  }

  async function watchNft(burnId: string) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        const response = await fetch("/api/claims/" + burnId, { cache: "no-store" });
        if (response.ok) {
          const json = await response.json();
          const status = json.nft?.status;
          if (status) {
            setResult((current) => ({
              ...current,
              zcash: json.nft?.revealTxid || current.zcash,
              nft: status,
            }));
            if (status === "confirmed") {
              setMessage("Zcash NFT confirmed. Inscription: " + json.nft.inscriptionId);
              return;
            }
            if (status === "failed") {
              setMessage("NFT mint needs a retry: " + (json.nft.error || "worker error"));
              return;
            }
          }
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
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
      if (!response.ok && response.status !== 202) throw new Error(json.error || "Zcash NFT claim failed");

      const burnId = json.proof?.burnId || json.claim?.burnId;
      setResult({
        solana: sent.signature,
        zcash: json.claim?.zcashTxid || undefined,
        burnId,
        nft: json.nft?.status || "queued",
      });
      setStage("done");
      setMessage(
        json.nft?.status === "confirmed"
          ? "Zcash NFT confirmed."
          : "Burn verified. Watching the Zcash NFT mint now…"
      );
      if (burnId && json.nft?.status !== "confirmed") void watchNft(burnId);
    } catch (error) {
      setStage("idle");
      setMessage(error instanceof Error ? error.message : "Claim failed");
    }
  }

  async function createToken() {
    setMessage("");
    try {
      if (!launchName.trim() || !launchSymbol.trim()) throw new Error("Name and ticker are required");
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

      const registration = await fetch("/api/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          creationSignature: sent.signature,
          mint: built.mint,
          creator: connected.publicKey.toBase58(),
          name: launchName,
          symbol: launchSymbol,
          imageUrl: launchImage || null,
          description: launchDescription || null,
        }),
      });
      const json = await registration.json();
      if (!registration.ok) throw new Error(json.error || "Token created but launch registration failed");

      setCreatedMint(built.mint);
      setMint(built.mint);
      setMessage("Launch live. Mint authority is revoked and the asset is registered on ZApp.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Token creation failed");
    }
  }

  const buttonText =
    stage === "signing" ? "Sign burn" :
    stage === "finalizing" ? "Waiting for Solana finality" :
    stage === "anchoring" ? "Creating Zcash claim" :
    stage === "done" ? "NFT queued" :
    "Burn & claim Zcash NFT";

  return (
    <section className="launchwrap shell">
      <div className="launchcard">
        <div className="launch-top">
          <div>
            <div className="eyebrow">ZAPP CLAIM</div>
            <h2>{initialSymbol ? "Burn $" + initialSymbol + " → Zcash NFT" : "Burn → Zcash NFT"}</h2>
          </div>
          <button className="wallet" onClick={() => connect().catch((e) => setMessage(e.message))}>
            {wallet ? wallet.slice(0, 4) + "…" + wallet.slice(-4) : "Connect Solana"}
          </button>
        </div>

        <label>
          <span>Solana mint</span>
          <input
            value={mint}
            readOnly={Boolean(initialMint)}
            onChange={(e) => setMint(e.target.value.trim())}
            placeholder="Mint address"
          />
        </label>
        <label>
          <span>Amount to destroy</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000000" inputMode="decimal" />
        </label>
        <label>
          <span>Zcash NFT destination</span>
          <input value={zcashAddress} onChange={(e) => setZcashAddress(e.target.value.trim())} placeholder="t1… or t3…" />
          <small>The destination is committed inside the same Solana transaction as the burn.</small>
        </label>

        <button className="primary" disabled={stage !== "idle" && stage !== "done"} onClick={migrate}>
          {buttonText}
        </button>

        {message && <div className="notice">{message}</div>}
        {(result.solana || result.zcash || result.burnId) && (
          <div className="resultbox">
            {result.solana && <div><b>Solana burn</b><code>{result.solana}</code></div>}
            {result.zcash && <div><b>Zcash proof tx</b><code>{result.zcash}</code></div>}
            {result.burnId && <div><b>ZApp claim ID</b><code>{result.burnId}</code></div>}
            {result.nft && <div><b>NFT</b><code>{result.nft}</code></div>}
          </div>
        )}
      </div>

      {!hideCreator && (
        <aside className="createcard">
          <div className="eyebrow">LAUNCH AN ASSET</div>
          <h3>Create the SPL side in one transaction</h3>
          <p>ZApp mints the fixed supply to you and revokes mint authority before the launch can be listed.</p>
          <label><span>Name</span><input value={launchName} onChange={(e) => setLaunchName(e.target.value)} placeholder="Zebra Coin" /></label>
          <label><span>Ticker</span><input value={launchSymbol} onChange={(e) => setLaunchSymbol(e.target.value.toUpperCase())} placeholder="ZEBRA" /></label>
          <label><span>Total supply</span><input value={createSupply} onChange={(e) => setCreateSupply(e.target.value)} inputMode="decimal" /></label>
          <label><span>Decimals</span><input value={createDecimals} onChange={(e) => setCreateDecimals(e.target.value)} inputMode="numeric" /></label>
          <label><span>Image URL</span><input value={launchImage} onChange={(e) => setLaunchImage(e.target.value)} placeholder="https://…" /></label>
          <label><span>Description</span><input value={launchDescription} onChange={(e) => setLaunchDescription(e.target.value)} placeholder="What is this launch?" /></label>
          <button className="secondary" onClick={createToken}>Create & launch</button>
          {createdMint && <code className="mintcode">{createdMint}</code>}
          <small>Registration is accepted only if the creator and mint both signed the finalized creation transaction.</small>
        </aside>
      )}
    </section>
  );
}
