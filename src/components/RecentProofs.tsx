"use client";

import { useEffect, useState } from "react";

type Nft = {
  burnId: string;
  mint: string;
  amountBaseUnits: string;
  recipient: string;
  currentOwner: string | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  status: string;
  indexerVerifiedAt: string | null;
  createdAt: string;
};

function formatBaseUnits(raw: string, decimals: number | null): string {
  const amount = BigInt(raw || "0");
  const d = decimals ?? 0;
  if (d <= 0) return amount.toString();
  const scale = 10n ** BigInt(d);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(d, "0")
    .replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

function timeAgo(value: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

export function RecentProofs() {
  const [rows, setRows] = useState<Nft[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/nfts?limit=6", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load burns");
        if (!cancelled) setRows(body.nfts || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load burns");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;

  return (
    <section className="recent-proofs shell">
      <div className="register-head">
        <div>
          <div className="eyebrow">EVERY BURN</div>
          <h2>Recent destruction</h2>
        </div>
        <a className="textlink" href="/explorer">Whole register →</a>
      </div>

      {!rows.length ? (
        <div className="recent-empty">
          The first public burn will appear here as soon as the mainnet canary
          opens ZApp.
        </div>
      ) : (
        <div className="recent-proof-grid">
          {rows.map((row) => {
            const verified =
              row.status === "confirmed" && Boolean(row.indexerVerifiedAt);
            const amount = formatBaseUnits(
              row.amountBaseUnits,
              row.decimals,
            );
            return (
              <a
                className="recent-proof"
                href={"/proof/" + row.burnId}
                key={row.burnId}
              >
                <div>
                  <span>{verified ? "VERIFIED" : row.status.toUpperCase()}</span>
                  <small>{timeAgo(row.createdAt)}</small>
                </div>
                <strong>{amount}</strong>
                <b>{row.symbol ? "$" + row.symbol : "SPL TOKEN"}</b>
                <code>
                  {row.burnId.slice(0, 8)}…{row.burnId.slice(-6)}
                </code>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
