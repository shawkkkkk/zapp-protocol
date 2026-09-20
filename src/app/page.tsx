import { AssetDiscovery } from "@/components/AssetDiscovery";
import { LaunchCreator } from "@/components/LaunchCreator";

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="#launch">Launch</a>
          <a href="#launches">Discover</a>
          <a href="#how">How it works</a>
          <a href="/explorer">Explorer</a>
          <a href="https://github.com/shawkkkkk/zapp-protocol" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="eyebrow">ZCASH ASSET LAUNCHPAD</div>
        <h1>Launch on Solana.<br /><span>Land on Zcash.</span></h1>
        <p className="lede">
          Create or register an SPL asset. Holders burn it on Solana and receive
          the corresponding collectible inscription/NFT on Zcash mainnet.
        </p>
        <div className="truthbar">
          <span>Real token burn</span>
          <span>Real Zcash NFT</span>
          <span>Publicly verifiable</span>
          <span>No custody of holder tokens</span>
        </div>
        <p className="hero-disclosure">
          ZApp NFTs are public claim objects, not native ZSAs. Native shielded-asset
          migration depends on what Zcash actually activates later.
        </p>
      </section>

      <LaunchCreator />

      <section id="launches" className="section shell">
        <div className="sectionhead discovery-head">
          <div>
            <div className="eyebrow">THE REGISTER</div>
            <h2>Live ZApp launches</h2>
            <p>Browse verified launches by activity, burns, and confirmed Zcash NFTs.</p>
          </div>
          <a className="textlink" href="/explorer">Open proof explorer →</a>
        </div>
        <AssetDiscovery />
      </section>

      <section id="how" className="section shell">
        <div className="sectionhead">
          <div className="eyebrow">HOW ZAPP WORKS</div>
          <h2>Three actions. Two chains. One public trail.</h2>
        </div>
        <div className="grid3">
          <article className="card">
            <div className="step">01</div>
            <h3>Launch</h3>
            <p>Create a fixed-supply SPL token or register an existing mint whose authority is already revoked.</p>
          </article>
          <article className="card">
            <div className="step">02</div>
            <h3>Burn</h3>
            <p>Holders destroy tokens on Solana and commit their Zcash destination in the same finalized transaction.</p>
          </article>
          <article className="card">
            <div className="step">03</div>
            <h3>Receive</h3>
            <p>ZApp independently verifies the burn and delivers the corresponding collectible inscription/NFT on Zcash.</p>
          </article>
        </div>
      </section>

      <section className="section shell statement">
        <div>
          <div className="eyebrow">HONEST BY DESIGN</div>
          <h2>NFT now. Native asset later.</h2>
        </div>
        <p>
          Today, the Zcash object is a public inscription/NFT tied to a verified SPL burn.
          It is not a native shielded asset. If compatible ZSAs activate later, ZApp can
          migrate from the canonical burn and ownership ledger under a separate auditable policy.
        </p>
      </section>

      <footer className="footer shell">
        <span>ZApp Protocol v1</span>
        <span>Solana burn → Zcash NFT</span>
      </footer>
    </main>
  );
}
