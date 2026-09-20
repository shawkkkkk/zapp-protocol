"use client";

import { useEffect, useState } from "react";

type Service = {
  status: string;
  fresh: boolean;
  heartbeatAt?: string;
  details?: string | null;
};

type Status = {
  publicLaunchEnabled: boolean;
  canaryEnabled: boolean;
  relayConfigured: boolean;
  dedicatedSolanaRpc: boolean;
  canonicalOriginConfigured: boolean;
  databaseConfigured: boolean;
  services: {
    nftWorker: Service;
    solanaWatcher: Service;
    zcashIndexer: Service;
  };
  nftQueue: {
    queued: number;
    active: number;
    confirmed: number;
    failed: number;
  } | null;
};

function ServiceRow({
  name,
  service,
}: {
  name: string;
  service: Service;
}) {
  const healthy = service.fresh && service.status === "ready";
  return (
    <div className="status-row">
      <span className={healthy ? "status-dot on" : "status-dot"} />
      <div>
        <b>{name}</b>
        <small>
          {healthy
            ? service.details || "ready"
            : service.status === "missing"
              ? "not running"
              : service.details || service.status}
        </small>
      </div>
      <strong>{healthy ? "OPERATIONAL" : "NOT READY"}</strong>
    </div>
  );
}

export default function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/status", { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Unable to load status");
          if (!cancelled) {
            setStatus(body);
            setError("");
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Status unavailable");
        });

    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="/burn">Burn</a>
          <a href="/#launch">Launch</a>
          <a href="/leaderboard">Leaderboard</a>
          <a href="/explorer">Explorer</a>
        </div>
      </nav>

      <section className="status-page shell">
        <div className="eyebrow">PUBLIC SYSTEM HEALTH</div>
        <h1>ZApp status</h1>
        <p>
          Live operational signals for the burn verifier, Zcash mint worker,
          automatic Solana watcher, and independent Zcash indexer.
        </p>

        {error && <div className="notice">{error}</div>}

        {status && (
          <>
            <div className="status-banner">
              <span className={status.publicLaunchEnabled ? "status-dot on" : "status-dot"} />
              <div>
                <b>
                  {status.publicLaunchEnabled
                    ? "Public launch is open"
                    : "Public launch is locked"}
                </b>
                <small>
                  {status.publicLaunchEnabled
                    ? "Irreversible public launch and burn actions are enabled."
                    : "Preview is online, but irreversible public actions remain disabled."}
                </small>
              </div>
            </div>

            <div className="status-services">
              <ServiceRow name="Zcash NFT worker" service={status.services.nftWorker} />
              <ServiceRow name="Solana burn watcher" service={status.services.solanaWatcher} />
              <ServiceRow name="Independent Zcash indexer" service={status.services.zcashIndexer} />
            </div>

            <div className="status-infra">
              <div>
                <span>Database</span>
                <b>{status.databaseConfigured ? "configured" : "missing"}</b>
              </div>
              <div>
                <span>Dedicated Solana RPC</span>
                <b>{status.dedicatedSolanaRpc ? "configured" : "required"}</b>
              </div>
              <div>
                <span>Zcash relay</span>
                <b>{status.relayConfigured ? "configured" : "required"}</b>
              </div>
              <div>
                <span>Permanent domain</span>
                <b>{status.canonicalOriginConfigured ? "configured" : "required"}</b>
              </div>
            </div>

            {status.nftQueue && (
              <div className="status-queue">
                <div><b>{status.nftQueue.queued}</b><span>queued</span></div>
                <div><b>{status.nftQueue.active}</b><span>active</span></div>
                <div><b>{status.nftQueue.confirmed}</b><span>confirmed</span></div>
                <div><b>{status.nftQueue.failed}</b><span>failed</span></div>
              </div>
            )}
          </>
        )}

        {!status && !error && <div className="proof-placeholder">Loading system status…</div>}

        <p className="status-note">
          This page reports service liveness, not an endorsement of any token
          launched through ZApp. Always verify the asset and destination before
          signing an irreversible burn.
        </p>
      </section>
    </main>
  );
}
