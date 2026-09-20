"use client";

import { useState } from "react";
import { Connection } from "@solana/web3.js";
import { useUnifiedWallet } from "@jup-ag/wallet-adapter";
import { ZAppWalletButton } from "@/components/ZAppWalletButton";
import { buildLaunchMessage } from "@/lib/launch";
import { bytesToHex, parseUiAmount } from "@/lib/protocol";
import {
  MAX_TOKEN_IMAGE_BYTES,
  TOKEN_IMAGE_TYPES,
  buildImageUploadMessage,
} from "@/lib/image-upload";
import {
  browserSolanaRpc,
  buildFixedSupplyMintTransaction,
} from "@/lib/client/solana";

const publicLaunchEnabled =
  process.env.NEXT_PUBLIC_ZAPP_PUBLIC_LAUNCH_ENABLED === "true";

type Mode = "new" | "existing";

type Inspection = {
  mint: string;
  tokenProgram: string;
  decimals: number;
  supplyBaseUnits: string;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
};

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
  throw new Error("Solana transaction did not finalize in time");
}

export function LaunchCreator() {
  const [mode, setMode] = useState<Mode>("new");
  const { publicKey, sendTransaction, signMessage } = useUnifiedWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [supply, setSupply] = useState("1000000000");
  const [decimals, setDecimals] = useState("6");
  const [minimumBurn, setMinimumBurn] = useState("1");

  const [existingMint, setExistingMint] = useState("");
  const [creationSignature, setCreationSignature] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [pendingLaunch, setPendingLaunch] = useState<{
    mint: string;
    creationSignature: string;
    creator: string;
    minBurnBaseUnits: string;
  } | null>(null);

  async function uploadImage(file: File): Promise<string> {
    if (!publicKey) throw new Error("Connect a Solana wallet first");
    if (!signMessage) throw new Error("The selected wallet does not support message signing");
    if (!TOKEN_IMAGE_TYPES.has(file.type)) throw new Error("Use PNG, JPG, GIF, or WebP");
    if (file.size <= 0 || file.size > MAX_TOKEN_IMAGE_BYTES) {
      throw new Error("Image must be 2 MB or smaller");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = bytesToHex(digest);
    const message = buildImageUploadMessage({
      sha256,
      byteSize: bytes.byteLength,
      contentType: file.type,
    });
    const signature = await signMessage(new TextEncoder().encode(message));

    const form = new FormData();
    form.set("file", file);
    form.set("creator", publicKey.toBase58());
    form.set("signature", bytesToHex(signature));

    const response = await fetch("/api/uploads/token-image", {
      method: "POST",
      body: form,
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Image upload failed");
    setImageUrl(json.imageUrl);
    return json.imageUrl as string;
  }

  function validateMetadata() {
    if (!name.trim()) throw new Error("Name is required");
    if (!symbol.trim()) throw new Error("Ticker is required");
    if (name.trim().length > 32) throw new Error("Name must be 32 characters or less");
    if (symbol.trim().length > 10) throw new Error("Ticker must be 10 characters or less");
  }

  async function registerLaunch(input: {
    mint: string;
    creationSignature: string;
    creator: string;
    minBurnBaseUnits: string;
  }) {
    validateMetadata();
    if (!publicKey) throw new Error("Connect a Solana wallet first");
    if (!signMessage) {
      throw new Error("The selected wallet does not support message signing");
    }

    const hostedImageUrl = imageFile ? await uploadImage(imageFile) : (imageUrl || null);

    const launchMessage = buildLaunchMessage({
      mint: input.mint,
      creationSignature: input.creationSignature,
      name,
      symbol,
      imageUrl: hostedImageUrl,
      description: description || null,
      websiteUrl: websiteUrl || null,
      xUrl: xUrl || null,
      minBurnBaseUnits: input.minBurnBaseUnits,
    });

    const authorization = await signMessage(
      new TextEncoder().encode(launchMessage),
    );

    const response = await fetch("/api/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mint: input.mint,
        creationSignature: input.creationSignature,
        creator: input.creator,
        registrationSignature: bytesToHex(authorization),
        name,
        symbol,
        imageUrl: hostedImageUrl,
        description: description || null,
        websiteUrl: websiteUrl || null,
        xUrl: xUrl || null,
        minBurnBaseUnits: input.minBurnBaseUnits,
      }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Launch registration failed");
    return json.asset;
  }

  async function inspectExisting(): Promise<Inspection | null> {
    setMessage("");
    setInspection(null);
    if (!existingMint.trim()) {
      setMessage("Enter the existing SPL mint first.");
      return null;
    }
    try {
      const response = await fetch(
        "/api/assets/inspect?mint=" + encodeURIComponent(existingMint.trim()),
        { cache: "no-store" },
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Unable to inspect mint");
      const inspected = json.mint as Inspection;
      setInspection(inspected);
      if (!inspected.mintAuthorityRevoked) {
        setMessage("This mint still has mint authority. Revoke it before a public ZApp listing.");
      }
      return inspected;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mint inspection failed");
      return null;
    }
  }

  async function launchNew() {
    setMessage("");
    if (!publicLaunchEnabled) {
      setMessage("Preview mode: launches unlock after the production mainnet canary passes.");
      return;
    }
    setBusy(true);
    try {
      validateMetadata();
      if (!publicKey) throw new Error("Connect a Solana wallet first");
      const owner = publicKey;

      const launchDecimals = Number.parseInt(decimals, 10);
      const minBurnBaseUnits = parseUiAmount(minimumBurn, launchDecimals).toString();
      const metadataOrigin =
        process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      const built = await buildFixedSupplyMintTransaction({
        owner,
        supplyUi: supply,
        decimals: launchDecimals,
        name,
        symbol,
        metadataOrigin,
      });
      const signature = await sendTransaction(
        built.transaction,
        new Connection(browserSolanaRpc(), "confirmed"),
      );
      setMessage("Token transaction sent. Waiting for Solana finality…");
      await waitForFinalized(signature);

      const pending = {
        mint: built.mint,
        creationSignature: signature,
        creator: owner.toBase58(),
        minBurnBaseUnits,
      };
      setPendingLaunch(pending);
      try {
        localStorage.setItem("zapp-pending-launch", JSON.stringify(pending));
      } catch {}

      await registerLaunch(pending);
      setPendingLaunch(null);
      try {
        localStorage.removeItem("zapp-pending-launch");
      } catch {}

      window.location.href = "/asset/" + built.mint;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }


  async function retryPendingRegistration() {
    if (!pendingLaunch) return;
    setBusy(true);
    setMessage("Retrying launch registration…");
    try {
      await registerLaunch(pendingLaunch);
      const mint = pendingLaunch.mint;
      setPendingLaunch(null);
      try {
        localStorage.removeItem("zapp-pending-launch");
      } catch {}
      window.location.href = "/asset/" + mint;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Registration retry failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function registerExisting() {
    setMessage("");
    if (!publicLaunchEnabled) {
      setMessage("Preview mode: public registration unlocks after the production mainnet canary passes.");
      return;
    }
    setBusy(true);
    try {
      validateMetadata();
      if (!existingMint.trim() || !creationSignature.trim()) {
        throw new Error("Mint and mint-creation transaction are required");
      }
      const inspected = inspection || (await inspectExisting());
      if (!inspected) throw new Error("Inspect the mint before registering it");
      if (!inspected.mintAuthorityRevoked) {
        throw new Error("Mint authority must be revoked before public registration");
      }
      if (!inspected.freezeAuthorityRevoked) {
        throw new Error("Freeze authority must be revoked before public registration");
      }
      const minBurnBaseUnits = parseUiAmount(minimumBurn, inspected.decimals).toString();

      if (!publicKey) throw new Error("Connect a Solana wallet first");
      const owner = publicKey;

      await registerLaunch({
        mint: existingMint.trim(),
        creationSignature: creationSignature.trim(),
        creator: owner.toBase58(),
        minBurnBaseUnits,
      });
      window.location.href = "/asset/" + existingMint.trim();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  const ticker = symbol.trim().toUpperCase() || "TICKER";

  return (
    <section className="creator-shell shell" id="launch">
      <div className="creator-panel">
        <div className="creator-heading">
          <div>
            <div className="eyebrow">CREATE A ZAPP LAUNCH</div>
            <h2>Launch a coin</h2>
          </div>
          <ZAppWalletButton />
        </div>

        {!publicLaunchEnabled && (
          <div className="launchgate compact">
            <b>Preview</b>
            <span>Creation is locked until the production Zcash canary passes.</span>
          </div>
        )}

        <div className="mode-tabs">
          <button
            className={mode === "new" ? "active" : ""}
            onClick={() => setMode("new")}
          >
            New token
          </button>
          <button
            className={mode === "existing" ? "active" : ""}
            onClick={() => setMode("existing")}
          >
            Existing SPL
          </button>
        </div>

        <div className="form-grid">
          <label>
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Zcash Cats"
              maxLength={32}
            />
          </label>
          <label>
            <span>Ticker</span>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="ZCATS"
              maxLength={10}
            />
          </label>
        </div>

        <label>
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this asset?"
            maxLength={500}
          />
        </label>

        <div className="form-grid">
          <div className="field-block">
            <span className="field-label">Token image</span>
            <div className="image-upload-field">
              <label className="image-upload-button">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (!file) return;
                    if (!TOKEN_IMAGE_TYPES.has(file.type)) {
                      setMessage("Use PNG, JPG, GIF, or WebP.");
                      return;
                    }
                    if (file.size > MAX_TOKEN_IMAGE_BYTES) {
                      setMessage("Image must be 2 MB or smaller.");
                      return;
                    }
                    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                    setImageFile(file);
                    setImageUrl("");
                    setImagePreview(URL.createObjectURL(file));
                    setMessage("");
                  }}
                />
                <span>{imageFile ? "Change image" : "Choose image"}</span>
              </label>
              <div className="image-upload-meta">
                {imageFile ? imageFile.name : "PNG, JPG, GIF or WebP · max 2 MB"}
              </div>
            </div>
          </div>
          <label>
            <span>Website</span>
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
        </div>

        <label>
          <span>X / Twitter</span>
          <input
            value={xUrl}
            onChange={(e) => setXUrl(e.target.value)}
            placeholder="https://x.com/…"
          />
        </label>

        <label>
          <span>Minimum burn for one Zcash NFT</span>
          <input
            value={minimumBurn}
            onChange={(e) => setMinimumBurn(e.target.value)}
            placeholder="1"
            inputMode="decimal"
          />
          <small>
            Burns below this amount are rejected by the protocol. The value is signed into
            your launch metadata and enforced server-side.
          </small>
        </label>

        {mode === "new" ? (
          <>
            <div className="form-grid">
              <label>
                <span>Total supply</span>
                <input
                  value={supply}
                  onChange={(e) => setSupply(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                <span>Decimals</span>
                <input
                  value={decimals}
                  onChange={(e) => setDecimals(e.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>
            <button
              className="primary"
              disabled={!publicLaunchEnabled || busy}
              onClick={launchNew}
            >
              {busy ? "Launching…" : "Create & launch"}
            </button>
            <p className="microcopy">
              The full supply is minted to your wallet and mint authority is revoked in the
              same Solana transaction. ZApp then authenticates your listing metadata.
            </p>
          </>
        ) : (
          <>
            <label>
              <span>Existing SPL / Token-2022 mint</span>
              <div className="input-action">
                <input
                  value={existingMint}
                  onChange={(e) => {
                    setExistingMint(e.target.value.trim());
                    setInspection(null);
                  }}
                  placeholder="Mint address"
                />
                <button className="secondary inline" onClick={inspectExisting}>
                  Inspect
                </button>
              </div>
            </label>

            {inspection && (
              <div className="inspection">
                <span className={inspection.mintAuthorityRevoked ? "ok" : "bad"}>
                  {inspection.mintAuthorityRevoked ? "✓ Mint authority revoked" : "✕ Mint authority active"}
                </span>
                <span className={inspection.freezeAuthorityRevoked ? "ok" : "bad"}>
                  {inspection.freezeAuthorityRevoked ? "✓ Freeze authority revoked" : "✕ Freeze authority active"}
                </span>
                <span>{inspection.decimals} decimals</span>
                <span>{inspection.supplyBaseUnits} raw supply</span>
              </div>
            )}

            <label>
              <span>Mint creation transaction</span>
              <input
                value={creationSignature}
                onChange={(e) => setCreationSignature(e.target.value.trim())}
                placeholder="Original finalized transaction signature"
              />
              <small>
                ZApp verifies that your connected wallet created the mint and that mint
                authority is currently revoked.
              </small>
            </label>

            <button
              className="primary"
              disabled={!publicLaunchEnabled || busy}
              onClick={registerExisting}
            >
              {busy ? "Registering…" : "Register existing asset"}
            </button>
          </>
        )}

        {pendingLaunch && (
          <div className="pending-launch">
            <div>
              <b>Token finalized; registration still pending.</b>
              <code>{pendingLaunch.mint}</code>
              <small>
                Your token already exists on Solana. Retrying registration does not mint
                another supply.
              </small>
            </div>
            <button
              className="secondary inline"
              disabled={busy}
              onClick={retryPendingRegistration}
            >
              Retry registration
            </button>
          </div>
        )}

        {message && <div className="notice">{message}</div>}
      </div>

      <aside className="creator-side">
        <div className="token-preview">
          <div className="preview-image">
            {imagePreview || imageUrl ? (
              <img src={imagePreview || imageUrl} alt="" />
            ) : (
              <span>{ticker.slice(0, 2)}</span>
            )}
          </div>
          <div>
            <span className="preview-label">LIVE PREVIEW</span>
            <h3>{name.trim() || "Your asset"}</h3>
            <b>{"$" + ticker}</b>
            <p>{description.trim() || "Burn on Solana. Receive the corresponding Zcash NFT."}</p>
          </div>
        </div>

        <div className="how-list">
          <div>
            <span>01</span>
            <h4>Launch</h4>
            <p>Create a fixed-supply SPL asset or register an existing verified mint.</p>
          </div>
          <div>
            <span>02</span>
            <h4>Burn</h4>
            <p>Holders burn on Solana and commit their Zcash address in the same transaction.</p>
          </div>
          <div>
            <span>03</span>
            <h4>Receive</h4>
            <p>ZApp verifies the burn and delivers a public Zcash inscription/NFT.</p>
          </div>
        </div>

        <div className="truth-note">
          <b>NFT now. ZSA later, if Zcash ships it.</b>
          <p>
            The NFT is real today. Future native-asset migration is a separate versioned
            policy—not a current consensus promise.
          </p>
        </div>
      </aside>
    </section>
  );
}
