import { AssetDiscovery } from "@/components/AssetDiscovery";
import { LaunchCreator } from "@/components/LaunchCreator";

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="#launch">Launch</a>
          <a href="#register">Register</a>
          <a href="/explorer">Explorer</a>
          <a
            href="https://github.com/shawkkkkk/zapp-protocol"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </nav>

      <header className="minimal-hero shell">
        <div className="eyebrow">ASSETS FOR ZCASH, TODAY</div>
        <h1>Launch on Solana.<br />Collect on Zcash.</h1>
        <p>
          Create or register an SPL asset. Holders burn tokens on Solana and
          receive the corresponding inscription/NFT on Zcash mainnet.
        </p>
        <div className="hero-facts">
          <span>Burn is real</span>
          <span>NFT is real</span>
          <span>No token custody</span>
          <span>Future ZSA migration is not guaranteed</span>
        </div>
      </header>

      <LaunchCreator />

      <section className="minimal-how shell">
        <div>
          <span>01</span>
          <b>Launch</b>
          <p>Create a fixed-supply SPL asset or register an existing one.</p>
        </div>
        <div>
          <span>02</span>
          <b>Burn</b>
          <p>Destroy tokens on Solana and choose a Zcash destination.</p>
        </div>
        <div>
          <span>03</span>
          <b>Receive</b>
          <p>Get the matching collectible inscription/NFT on Zcash.</p>
        </div>
      </section>

      <section id="register" className="section shell register-section">
        <div className="sectionhead register-head">
          <div>
            <div className="eyebrow">THE REGISTER</div>
            <h2>Live launches</h2>
          </div>
          <a className="textlink" href="/explorer">Proof explorer →</a>
        </div>
        <AssetDiscovery />
      </section>

      <section className="minimal-disclosure shell">
        <b>NFT now. Native asset later.</b>
        <p>
          ZApp NFTs are public claim objects backed by independently verified
          SPL burns. They are not native shielded Zcash assets today.
        </p>
      </section>

      <footer className="footer shell">
        <span>ZApp Protocol v1</span>
        <span>Solana burn → Zcash NFT</span>
      </footer>
    </main>
  );
}
