"use client";

import { useEffect, useMemo, useState } from "react";

type Sort = "trending" | "newest" | "most-burned" | "recently-stamped";

type Asset = {
  mint: string;
  name: string;
  symbol: string;
  image_url: string | null;
  description: string | null;
  creator: string;
  verified_burns: number;
  burned_base_units: string;
  confirmed_nfts: number;
  pending_nfts: number;
  burns_24h: number;
  nfts_24h: number;
  last_stamp_at: string | null;
};

const TABS: Array<{ key: Sort; label: string }> = [
  { key: "trending", label: "Trending" },
  { key: "newest", label: "New" },
  { key: "most-burned", label: "Most burned" },
  { key: "recently-stamped", label: "Recently stamped" },
];

function compact(value: string): string {
  const n = BigInt(value || "0");
  if (n >= 1_000_000_000n) return (Number(n / 10_000_000n) / 100).toFixed(2) + "B";
  if (n >= 1_000_000n) return (Number(n / 10_000n) / 100).toFixed(2) + "M";
  if (n >= 1_000n) return (Number(n / 10n) / 100).toFixed(2) + "K";
  return n.toString();
}

export function AssetDiscovery() {
  const [sort, setSort] = useState<Sort>("trending");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch("/api/assets?limit=24&sort=" + sort, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load launches");
        if (!cancelled) setAssets(body.assets || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load launches");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sort]);

  const emptyCopy = useMemo(() => {
    if (sort === "recently-stamped") return "No Zcash NFTs have been confirmed yet.";
    if (sort === "most-burned") return "No verified burns yet.";
    return "No public ZApp launches yet. Be first.";
  }, [sort]);

  return (
    <div>
      <div className="discovery-tabs" role="tablist" aria-label="Launch discovery">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={sort === tab.key ? "active" : ""}
            onClick={() => setSort(tab.key)}
            role="tab"
            aria-selected={sort === tab.key}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="notice">{error}</div>}
      {loading && <div className="proof-placeholder">Loading launches…</div>}
      {!loading && !error && assets.length === 0 && (
        <div className="proof-placeholder">{emptyCopy}</div>
      )}

      {!loading && !error && assets.length > 0 && (
        <div className="assetgrid discovery-grid">
          {assets.map((asset) => (
            <a className="assetcard discovery-card" href={"/asset/" + asset.mint} key={asset.mint}>
              <div className="assetavatar">
                {asset.image_url ? (
                  <img src={asset.image_url} alt="" />
                ) : (
                  <span>{asset.symbol.slice(0, 2)}</span>
                )}
              </div>

              <div className="assetcard-body">
                <div className="assetcard-title">
                  <div>
                    <h3>{asset.name}</h3>
                    <b>{"$" + asset.symbol}</b>
                  </div>
                  {asset.confirmed_nfts > 0 ? (
                    <span className="stamp-badge">Zcash live</span>
                  ) : asset.pending_nfts > 0 ? (
                    <span className="stamp-badge pending">Minting</span>
                  ) : null}
                </div>

                <p>{asset.description || "Burn on Solana. Receive the corresponding Zcash NFT."}</p>

                <div className="assetmetrics">
                  <span><b>{asset.verified_burns}</b> burns</span>
                  <span><b>{compact(asset.burned_base_units)}</b> burned</span>
                  <span><b>{asset.confirmed_nfts}</b> NFTs</span>
                </div>

                <code>{asset.mint.slice(0, 8)}…{asset.mint.slice(-6)}</code>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
