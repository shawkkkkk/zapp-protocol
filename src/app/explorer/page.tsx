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
  status: string;
  commitTxid: string | null;
  revealTxid: string | null;
  inscriptionId: string | null;
  contentSha256: string;
  error: string | null;
};

export default function Explorer() {
  const [nfts, setNfts] = useState<Nft[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () =>
      fetch("/api/nfts?limit=100")
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error || "Unable to load NFT mints");
          setNfts(body.nfts || []);
        })
        .catch((e) => setError(e.message));
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="shell explorer">
      <a className="brand" href="/">ZApp</a>
      <div className="sectionhead">
        <div className="eyebrow">PUBLIC MINT QUEUE</div>
        <h1>Zcash NFT explorer</h1>
        <p>Every row starts with a finalized Solana burn and ends with a collectible inscription on Zcash.</p>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Asset</th>
              <th>Amount</th>
              <th>Owner</th>
              <th>Inscription</th>
            </tr>
          </thead>
          <tbody>
            {nfts.map((nft) => (
              <tr key={nft.burnId}>
                <td><span className={"status " + nft.status}>{nft.status}</span></td>
                <td>
                  <a className="textlink" href={"/asset/" + nft.mint}>
                    {nft.symbol ? "$" + nft.symbol : nft.mint.slice(0, 8) + "…"}
                  </a>
                </td>
                <td>{nft.amountBaseUnits}</td>
                <td><code>{(nft.currentOwner || nft.recipient).slice(0, 8)}…{(nft.currentOwner || nft.recipient).slice(-6)}</code></td>
                <td>
                  <code>
                    {nft.inscriptionId
                      ? nft.inscriptionId.slice(0, 12) + "…i0"
                      : nft.revealTxid
                        ? nft.revealTxid.slice(0, 12) + "…"
                        : "pending"}
                  </code>
                </td>
              </tr>
            ))}
            {!nfts.length && !error && <tr><td colSpan={5}>No ZApp NFT mints yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
