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
  commitTxid: string | null;
  revealTxid: string | null;
  inscriptionId: string | null;
  contentSha256: string;
  indexerVerifiedAt: string | null;
  indexerVerifiedHeight: string | null;
  error: string | null;
  indexerVerifiedAt: string | null;
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

export default function Explorer() {
  const [nfts, setNfts] = useState<Nft[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () =>
      fetch("/api/nfts?limit=100", { cache: "no-store" })
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
      <nav className="explorer-nav">
        <a className="brand" href="/">ZApp</a>
        <a className="textlink" href="/">Back to launchpad</a>
      </nav>

      <div className="sectionhead">
        <div className="eyebrow">PUBLIC PROOF REGISTER</div>
        <h1>Every burn.</h1>
        <p>
          Finalized Solana destruction, Zcash inscription delivery, and independent
          verification in one public trail.
        </p>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Verification</th>
              <th>Asset</th>
              <th>Destroyed</th>
              <th>Current owner</th>
              <th>Proof</th>
            </tr>
          </thead>
          <tbody>
            {nfts.map((nft) => {
              const verified = Boolean(
                nft.status === "confirmed" && nft.indexerVerifiedAt,
              );
              const owner = nft.currentOwner || nft.recipient;
              return (
                <tr key={nft.burnId}>
                  <td>
                    <span className={"status " + (verified ? "verified" : nft.status)}>
                      {verified ? "verified" : nft.status}
                    </span>
                  </td>
                  <td>
                    <a className="textlink" href={"/asset/" + nft.mint}>
                      {nft.symbol
                        ? "$" + nft.symbol
                        : nft.mint.slice(0, 8) + "…"}
                    </a>
                  </td>
                  <td>
                    {formatBaseUnits(nft.amountBaseUnits, nft.decimals)}
                    {nft.symbol ? " $" + nft.symbol : ""}
                  </td>
                  <td>
                    <code>
                      {owner.slice(0, 8)}…{owner.slice(-6)}
                    </code>
                  </td>
                  <td>
                    <a className="textlink" href={"/proof/" + nft.burnId}>
                      {nft.inscriptionId ? "View proof →" : "View status →"}
                    </a>
                  </td>
                </tr>
              );
            })}
            {!nfts.length && !error && (
              <tr>
                <td colSpan={5}>No ZApp burns yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
