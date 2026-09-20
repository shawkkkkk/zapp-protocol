"use client";

import { useEffect, useState } from "react";

type Claim = {
  burnId: string;
  solanaSignature: string;
  mint: string;
  amountBaseUnits: string;
  recipient: string;
  zcashTxid: string | null;
  zcashHeight: string | null;
  status: string;
};

export default function Explorer() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/claims?limit=100")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Unable to load proofs");
        setClaims(body.claims || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="shell explorer">
      <a className="brand" href="/">ZApp</a>
      <div className="sectionhead">
        <div className="eyebrow">CANONICAL INDEX</div>
        <h1>Proof explorer</h1>
        <p>Every confirmed entry is reproducible from public Solana and Zcash chain data.</p>
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="tablewrap">
        <table>
          <thead><tr><th>Status</th><th>Mint</th><th>Amount</th><th>Destination</th><th>Zcash</th></tr></thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.burnId}>
                <td><span className={`status ${claim.status}`}>{claim.status}</span></td>
                <td><code>{claim.mint.slice(0, 8)}…{claim.mint.slice(-6)}</code></td>
                <td>{claim.amountBaseUnits}</td>
                <td><code>{claim.recipient.slice(0, 8)}…{claim.recipient.slice(-6)}</code></td>
                <td><code>{claim.zcashTxid ? `${claim.zcashTxid.slice(0, 10)}…` : "pending"}</code></td>
              </tr>
            ))}
            {!claims.length && !error && <tr><td colSpan={5}>No indexed proofs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
