import { AssetGrid } from "@/components/AssetGrid";
import { Launchpad } from "@/components/Launchpad";

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="#launches">Launches</a>
          <a href="#how">How it works</a>
          <a href="/explorer">Explorer</a>
          <a href="https://github.com/shawkkkkk/zapp-protocol" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="eyebrow">ZCASH ASSET LAUNCHPAD</div>
        <h1>Launch before<br /><span>ZSAs exist.</span></h1>
        <p className="lede">
          Create an SPL asset, let holders burn it on Solana, and deliver a collectible
          inscription/NFT to their chosen Zcash mainnet address.
        </p>
        <div className="truthbar">
          <span>Real token burn</span>
          <span>Real Zcash NFT</span>
          <span>Publicly verifiable</span>
        </div>
      </section>

      <Launchpad />

      <section id="launches" className="section shell">
        <div className="sectionhead">
          <div className="eyebrow">LIVE LAUNCHES</div>
          <h2>Assets migrating into Zcash</h2>
          <p>Each launch is tied to a finalized SPL mint transaction with revoked mint authority.</p>
        </div>
        <AssetGrid />
      </section>

      <section id="how" className="section shell">
        <div className="sectionhead">
          <div className="eyebrow">HOW ZAPP WORKS</div>
          <h2>The workaround is the product.</h2>
        </div>
        <div className="grid3">
          <article className="card">
            <div className="step">01</div>
            <h3>Launch</h3>
            <p>Create a fixed-supply SPL token through ZApp or enter a verified public ZApp launch.</p>
          </article>
          <article className="card">
            <div className="step">02</div>
            <h3>Burn</h3>
            <p>Holders destroy tokens on Solana and commit their Zcash destination in the same finalized transaction.</p>
          </article>
          <article className="card">
            <div className="step">03</div>
            <h3>Claim</h3>
            <p>ZApp verifies the burn and mints the corresponding collectible inscription/NFT to that Zcash address.</p>
          </article>
        </div>
      </section>

      <section className="section shell statement">
        <div>
          <div className="eyebrow">HONEST BY DESIGN</div>
          <h2>Real NFT now. Native asset later.</h2>
        </div>
        <p>
          ZApp NFTs are public Zcash inscriptions representing verified destruction of SPL tokens.
          They are not native shielded assets today. If compatible ZSAs activate later, canonical NFT
          ownership and burn amounts are the intended migration basis under a separately versioned policy.
        </p>
      </section>

      <footer className="footer shell">
        <span>ZApp Protocol v1</span>
        <span>Solana burn → Zcash NFT</span>
      </footer>
    </main>
  );
}
