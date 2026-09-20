"use client";

import { useState } from "react";
import { Connection } from "@solana/web3.js";
import { useUnifiedWallet } from "@jup-ag/wallet-adapter";
import { ZAppWalletButton } from "@/components/ZAppWalletButton";
import {
  browserSolanaRpc,
  buildBurnAndProofTransaction,
} from "@/lib/client/solana";

type Stage = "idle" | "signing" | "finalizing" | "anchoring" | "done";

async function waitForFinalized(signature: string): Promise<void> {
  const connection = new Connection(browserSolanaRpc(), "confirmed");
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await connection.getSignatureStatuses(
      [signature],
      { searchTransactionHistory: true },
    );
    const status = result.value[0];
    if (status?.err) throw new Error("Solana transaction failed");
    if (status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    "Solana transaction was not finalized in the expected window. Retry with the same signature.",
  );
}

const publicLaunchEnabled =
  process.env.NEXT_PUBLIC_ZAPP_PUBLIC_LAUNCH_ENABLED === "true";

export function Launchpad({
  initialMint = "",
  initialSymbol = "",
  minimumBurnLabel = "",
  forceEnabled = false,
}: {
  initialMint?: string;
  initialSymbol?: string;
  hideCreator?: boolean;
  minimumBurnLabel?: string;
  forceEnabled?: boolean;
}) {
  const launchEnabled = publicLaunchEnabled || forceEnabled;
  const { publicKey, sendTransaction, wallet } = useUnifiedWallet();
  const [mint, setMint] = useState(initialMint);
  const [amount, setAmount] = useState("");
  const [zcashAddress, setZcashAddress] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{
    solana?: string;
    zcash?: string;
    burnId?: string;
    nft?: string;
  }>({});
  const [recoverySignature, setRecoverySignature] = useState("");
  const [reviewing, setReviewing] = useState(false);

  async function watchNft(burnId: string) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        const response = await fetch("/api/claims/" + burnId, {
          cache: "no-store",
        });
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
              setMessage(
                "Zcash NFT confirmed. Inscription: " + json.nft.inscriptionId,
              );
              return;
            }
            if (status === "failed") {
              setMessage(
                "NFT mint needs a retry: " +
                  (json.nft.error || "worker error"),
              );
              return;
            }
          }
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  async function claimFromSignature(signature: string) {
    const response = await fetch("/api/claims", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ solanaSignature: signature }),
    });
    const json = await response.json();
    if (!response.ok && response.status !== 202) {
      throw new Error(json.error || "Zcash NFT claim failed");
    }

    const burnId = json.proof?.burnId || json.claim?.burnId;
    setResult({
      solana: signature,
      zcash: json.claim?.zcashTxid || undefined,
      burnId,
      nft: json.nft?.status || "queued",
    });
    if (burnId && json.nft?.status !== "confirmed") void watchNft(burnId);
    return json;
  }

  async function recoverBurn() {
    setMessage("");
    if (!launchEnabled) {
      setMessage(
        "ZApp is in preview mode. Public burns and NFT claims are locked until production readiness passes.",
      );
      return;
    }
    const signature = recoverySignature.trim();
    if (!signature) {
      setMessage("Paste the finalized Solana burn transaction signature.");
      return;
    }

    try {
      setStage("anchoring");
      const json = await claimFromSignature(signature);
      setStage("done");
      setMessage(
        json.nft?.status === "confirmed"
          ? "This burn already has a confirmed Zcash NFT."
          : "Burn recovered and queued. Watching NFT delivery now…",
      );
    } catch (error) {
      setStage("idle");
      setMessage(
        error instanceof Error ? error.message : "Burn recovery failed",
      );
    }
  }

  async function migrate() {
    setMessage("");
    if (!launchEnabled) {
      setMessage(
        "ZApp is in preview mode. Public burns are locked until production readiness passes.",
      );
      return;
    }
    if (!publicKey) {
      setMessage("Connect a Solana wallet first.");
      return;
    }
    if (!mint.trim()) {
      setMessage("A Solana mint is required.");
      return;
    }
    if (!amount.trim()) {
      setMessage("Enter the amount you want to destroy.");
      return;
    }
    if (!zcashAddress.trim()) {
      setMessage("Enter the Zcash destination for the resulting proof.");
      return;
    }

    setReviewing(false);
    setResult({});
    try {
      setStage("signing");
      const built = await buildBurnAndProofTransaction({
        owner: publicKey,
        mint,
        amountUi: amount,
        zcashAddress,
      });

      const signature = await sendTransaction(
        built.transaction,
        new Connection(browserSolanaRpc(), "confirmed"),
      );
      setResult({ solana: signature });

      setStage("finalizing");
      await waitForFinalized(signature);

      setStage("anchoring");
      const json = await claimFromSignature(signature);
      setStage("done");
      setMessage(
        json.nft?.status === "confirmed"
          ? "Zcash NFT confirmed."
          : "Burn verified. Watching the Zcash NFT mint now…",
      );
    } catch (error) {
      setStage("idle");
      setMessage(error instanceof Error ? error.message : "Claim failed");
    }
  }

  const buttonText =
    stage === "signing"
      ? "Approve burn"
      : stage === "finalizing"
        ? "Waiting for Solana finality"
        : stage === "anchoring"
          ? "Creating Zcash NFT"
          : stage === "done"
            ? "NFT queued"
            : "Burn & claim Zcash NFT";

  return (
    <section className="launchwrap single shell">
      {!launchEnabled && (
        <div className="launchgate">
          <b>Preview mode</b>
          <span>
            Irreversible burns remain locked until the production mainnet canary
            passes.
          </span>
        </div>
      )}

      <div className="launchcard">
        <div className="launch-top">
          <div>
            <div className="eyebrow">BURN → ZCASH</div>
            <h2>
              {initialSymbol
                ? "Burn $" + initialSymbol + " → Zcash NFT"
                : "Burn → Zcash NFT"}
            </h2>
            {wallet?.adapter?.name && (
              <span className="connected-with">
                Connected with {wallet.adapter.name}
              </span>
            )}
          </div>
          <ZAppWalletButton compact />
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
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={minimumBurnLabel || "Amount"}
            inputMode="decimal"
          />
          {minimumBurnLabel && (
            <small>
              Minimum for one Zcash NFT: {minimumBurnLabel}{" "}
              {initialSymbol ? "$" + initialSymbol : "tokens"}.
            </small>
          )}
        </label>

        <label>
          <span>Zcash NFT destination</span>
          <input
            value={zcashAddress}
            onChange={(e) => setZcashAddress(e.target.value.trim())}
            placeholder="t1… or t3…"
          />
          <small>
            This address is committed inside the same Solana transaction as the
            burn.
          </small>
        </label>

        {reviewing && stage === "idle" && (
          <div className="burn-review">
            <div className="burn-review-head">
              <b>Review permanent burn</b>
              <span>This cannot be reversed.</span>
            </div>
            <div className="burn-review-grid">
              <div>
                <span>Destroy</span>
                <strong>
                  {amount || "—"} {initialSymbol ? "$" + initialSymbol : ""}
                </strong>
              </div>
              <div>
                <span>Solana mint</span>
                <code>{mint || "—"}</code>
              </div>
              <div>
                <span>Zcash destination</span>
                <code>{zcashAddress || "—"}</code>
              </div>
            </div>
            <p>
              Signing destroys these tokens on Solana. ZApp cannot restore,
              refund, or redirect them afterward. The Zcash destination above is
              committed in the same transaction.
            </p>
            <div className="burn-review-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setReviewing(false)}
              >
                Go back
              </button>
              <button
                className="primary danger-confirm"
                type="button"
                onClick={migrate}
              >
                Confirm permanent burn
              </button>
            </div>
          </div>
        )}

        {!reviewing && (
          <button
            className="primary"
            disabled={
              !launchEnabled ||
              (stage !== "idle" && stage !== "done")
            }
            onClick={() => {
              setMessage("");
              if (!launchEnabled) {
                setMessage(
                  "ZApp is in preview mode. Public burns are locked until production readiness passes.",
                );
                return;
              }
              if (!publicKey) {
                setMessage("Connect a Solana wallet first.");
                return;
              }
              if (!mint.trim() || !amount.trim() || !zcashAddress.trim()) {
                setMessage("Complete the mint, amount, and Zcash destination first.");
                return;
              }
              setReviewing(true);
            }}
          >
            Review burn
          </button>
        )}

        {stage !== "idle" && stage !== "done" && (
          <button className="primary" disabled>
            {buttonText}
          </button>
        )}

        <div className="launch-divider">
          <span>already burned?</span>
        </div>

        <label>
          <span>Recover finalized burn</span>
          <input
            value={recoverySignature}
            onChange={(e) => setRecoverySignature(e.target.value.trim())}
            placeholder="Solana transaction signature"
          />
          <small>
            Re-submitting cannot redirect the NFT. The original burn permanently
            commits its Zcash destination.
          </small>
        </label>

        <button
          className="secondary"
          disabled={
            !launchEnabled ||
            (stage !== "idle" && stage !== "done")
          }
          onClick={recoverBurn}
        >
          Recover & queue NFT
        </button>

        {message && <div className="notice">{message}</div>}

        {(result.solana || result.zcash || result.burnId) && (
          <div className="resultbox">
            {result.solana && (
              <div>
                <b>Solana burn</b>
                <code>{result.solana}</code>
              </div>
            )}
            {result.zcash && (
              <div>
                <b>Zcash inscription tx</b>
                <code>{result.zcash}</code>
              </div>
            )}
            {result.burnId && (
              <div>
                <b>ZApp claim ID</b>
                <code>{result.burnId}</code>
              </div>
            )}
            {result.nft && (
              <div>
                <b>NFT status</b>
                <code>{result.nft}</code>
              </div>
            )}
            {result.burnId && (
              <a className="proof-link" href={"/proof/" + result.burnId}>
                View Proof of Destruction →
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
