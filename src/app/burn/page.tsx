import { AssetDiscovery } from "@/components/AssetDiscovery";
import { Launchpad } from "@/components/Launchpad";

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
          Burn a registered ZApp asset and commit the destination in the same
          transaction. ZApp independently verifies the burn before minting the
          corresponding Zcash inscription/NFT.
        </p>
      </header>

      <Launchpad />

      <section className="section shell burn-register">
        <div className="register-head">
          <div>
            <div className="eyebrow">REGISTERED ASSETS</div>
            <h2>Choose something to burn</h2>
          </div>
          <a className="textlink" href="/leaderboard">Leaderboard →</a>
        </div>
        <AssetDiscovery />
      </section>
    </main>
  );
}
