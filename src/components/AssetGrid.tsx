"use client";

import { useEffect, useState } from "react";

type Asset = {
  mint: string;
  name: string;
  symbol: string;
  image_url: string | null;
  description: string | null;
  creator: string;
};

export function AssetGrid() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/assets?limit=24")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Unable to load launches");
        setAssets(body.assets || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="notice">{error}</div>;
  if (!assets.length) return <div className="proof-placeholder">No public ZApp launches yet. Be first.</div>;

  return (
    <div className="assetgrid">
      {assets.map((asset) => (
        <a className="assetcard" href={"/asset/" + asset.mint} key={asset.mint}>
          <div className="assetavatar">
            {asset.image_url ? <img src={asset.image_url} alt="" /> : <span>{asset.symbol.slice(0, 2)}</span>}
          </div>
          <div>
            <h3>{asset.name}</h3>
            <b>{"$" + asset.symbol}</b>
            <p>{asset.description || "Burn on Solana. Claim the Zcash NFT."}</p>
            <code>{asset.mint.slice(0, 8)}…{asset.mint.slice(-6)}</code>
          </div>
        </a>
      ))}
    </div>
  );
}
