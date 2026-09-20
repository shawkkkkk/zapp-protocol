import { BurnDesk } from "@/components/BurnDesk";

export const dynamic = "force-dynamic";

export default function BurnPage() {
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

      <header className="burn-hero shell">
        <div className="eyebrow">SOLANA → ZCASH</div>
        <h1>Destroy on Solana.<br />Keep the proof on Zcash.</h1>
        <p>
          Choose a registered asset, destroy tokens in your own wallet, and
          commit the Zcash destination in the same transaction. ZApp verifies
          both chains independently.
        </p>
      </header>

      <BurnDesk />

      <section className="minimal-disclosure shell">
        <b>Burning is permanent.</b>
        <p>
          ZApp never takes custody of the tokens you destroy. Once your wallet
          signs the Solana burn, the tokens cannot be restored or redirected.
          The resulting Zcash proof records exactly what was destroyed.
        </p>
      </section>
    </main>
  );
}
