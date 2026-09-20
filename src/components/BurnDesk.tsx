"use client";

import { useEffect, useMemo, useState } from "react";
import { Launchpad } from "@/components/Launchpad";

type Asset = {
  mint: string;
  name: string;
  symbol: string;
  image_url: string | null;
  decimals: number;
  min_burn_base_units: string;
  verified_burns: number;
  confirmed_nfts: number;
};

function formatBaseUnits(raw: string, decimals: number): string {
  const value = BigInt(raw || "0");
  if (decimals <= 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? whole + "." + fraction : whole.toString();
}

function shortMint(mint: string) {
  return mint.slice(0, 6) + "…" + mint.slice(-5);
}

export function BurnDesk() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/assets?limit=100&sort=trending", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load assets");
        const rows = (body.assets || []) as Asset[];
        setAssets(rows);
        if (rows.length === 1) setSelected(rows[0]);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Unable to load assets"),
      );
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets.slice(0, 12);
    return assets
      .filter(
        (asset) =>
          asset.name.toLowerCase().includes(needle) ||
          asset.symbol.toLowerCase().includes(needle) ||
          asset.mint.toLowerCase().includes(needle),
      )
      .slice(0, 20);
  }, [assets, query]);

  return (
    <section className="burn-desk shell">
      <div className="burn-picker">
        <div className="eyebrow">1 · CHOOSE ASSET</div>
        <h2>What are you destroying?</h2>

        <input
          className="burn-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, ticker, or mint"
          aria-label="Search registered ZApp assets"
        />

        {error && <div className="notice">{error}</div>}

        <div className="burn-asset-list">
          {filtered.map((asset) => (
            <button
              type="button"
              key={asset.mint}
              className={
                selected?.mint === asset.mint
                  ? "burn-asset active"
                  : "burn-asset"
              }
              onClick={() => setSelected(asset)}
            >
              <div className="burn-asset-avatar">
                {asset.image_url ? (
                  <img src={asset.image_url} alt="" />
                ) : (
                  <span>{asset.symbol.slice(0, 2)}</span>
                )}
              </div>
              <div className="burn-asset-copy">
                <b>{asset.name}</b>
                <span>{"$" + asset.symbol}</span>
                <code>{shortMint(asset.mint)}</code>
              </div>
              <div className="burn-asset-stats">
                <span>{asset.verified_burns} burns</span>
                <span>{asset.confirmed_nfts} Zcash</span>
              </div>
            </button>
          ))}

          {!filtered.length && !error && (
            <div className="burn-picker-empty">
              No registered ZApp asset matches that search.
            </div>
          )}
        </div>
      </div>

      <div className="burn-desk-form">
        {selected ? (
          <Launchpad
            key={selected.mint}
            initialMint={selected.mint}
            initialSymbol={selected.symbol}
            minimumBurnLabel={formatBaseUnits(
              selected.min_burn_base_units,
              selected.decimals,
            )}
          />
        ) : (
          <div className="burn-select-prompt">
            <div className="eyebrow">2 · BURN</div>
            <h2>Select an asset first.</h2>
            <p>
              The mint, ticker, and protocol-enforced minimum will be filled in
              automatically.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
