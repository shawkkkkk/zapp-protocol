"use client";

import { useEffect, useState } from "react";
import {
  LaunchCreator,
  type LaunchedAsset,
} from "@/components/LaunchCreator";
import { Launchpad } from "@/components/Launchpad";

export function CanaryConsole() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [asset, setAsset] = useState<LaunchedAsset | null>(null);

  async function refresh() {
    const response = await fetch("/api/canary/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json();
    setEnabled(Boolean(body.enabled));
    setAuthorized(Boolean(body.authorized));
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function unlock() {
    setMessage("");
    const response = await fetch("/api/canary/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ secret }),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error || "Canary authorization failed");
      return;
    }
    setSecret("");
    setAuthorized(true);
  }

  async function lock() {
    await fetch("/api/canary/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
    setAuthorized(false);
    setAsset(null);
  }

  if (enabled === null) {
    return <div className="canary-login shell">Checking canary state…</div>;
  }

  if (!enabled) {
    return (
      <div className="canary-login shell">
        <div className="eyebrow">PRIVATE MAINNET CANARY</div>
        <h1>Canary mode is off.</h1>
        <p>
          This console is intentionally unavailable until the production relay
          infrastructure is configured.
        </p>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="canary-login shell">
        <div className="eyebrow">PRIVATE MAINNET CANARY</div>
        <h1>Unlock canary console</h1>
        <p>
          Public launch remains locked. This session authorizes only the real
          production mutation path for the canary.
        </p>
        <label>
          <span>Canary secret</span>
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void unlock();
            }}
          />
        </label>
        <button className="primary" onClick={unlock}>
          Unlock
        </button>
        {message && <div className="notice">{message}</div>}
      </div>
    );
  }

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <span>PRIVATE CANARY</span>
          <button className="textlink canary-lock" onClick={lock}>
            Lock session
          </button>
        </div>
      </nav>

      <section className="canary-banner shell">
        <b>Public launch is still locked.</b>
        <span>
          Transactions below are real mainnet transactions using the exact
          production launch and burn paths.
        </span>
      </section>

      {!asset ? (
        <LaunchCreator forceEnabled onLaunched={setAsset} />
      ) : (
        <>
          <section className="canary-next shell">
            <div className="eyebrow">TOKEN REGISTERED</div>
            <h1>{"$" + asset.symbol}</h1>
            <code>{asset.mint}</code>
            <p>
              Next: burn the smallest allowed amount and let the background
              watcher discover it automatically.
            </p>
          </section>
          <Launchpad
            initialMint={asset.mint}
            initialSymbol={asset.symbol}
            minimumBurnLabel={asset.minimumBurn}
            forceEnabled
          />
        </>
      )}
    </main>
  );
}
