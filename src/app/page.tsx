import { Launchpad } from "@/components/Launchpad";

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="#how">How it works</a>
          <a href="#proofs">Proofs</a>
          <a href="https://github.com/shawkkkkk/zapp-protocol" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="eyebrow">ZCASH MAINNET × SOLANA</div>
        <h1>Assets on Zcash.<br /><span>Before ZSAs.</span></h1>
        <p className="lede">
          Burn a real SPL token on Solana. ZApp verifies the destruction and anchors a
          compact proof to a real Zcash mainnet transaction.
        </p>
        <div className="truthbar">
          <span>Real SPL burn</span>
          <span>Real Zcash transaction</span>
          <span>No fake ZSA claims</span>
        </div>
      </section>

      <Launchpad />

      <section id="how" className="section shell">
        <div className="sectionhead">
          <div className="eyebrow">THE RULES ARE THE PRODUCT</div>
          <h2>Anyone can write data. Only valid proofs count.</h2>
        </div>
        <div className="grid3">
          <article className="card">
            <div className="step">01</div>
            <h3>Destroy</h3>
            <p>A single Solana transaction burns tokens with BurnChecked and commits your Zcash t-address in a ZAPP1 memo.</p>
          </article>
          <article className="card">
            <div className="step">02</div>
            <h3>Verify</h3>
            <p>ZApp requires finality, one burn, one destination, an exact mint, and exact uint64 base-unit accounting.</p>
          </article>
          <article className="card">
            <div className="step">03</div>
            <h3>Prove</h3>
            <p>A 78-byte ZApp Proof is placed in OP_RETURN beside a marker output to the destination committed on Solana.</p>
          </article>
        </div>
      </section>

      <section className="section shell statement">
        <div>
          <div className="eyebrow">WHAT ZAPP IS — AND ISN'T</div>
          <h2>No quotation-mark engineering.</h2>
        </div>
        <p>
          A ZApp Proof is an overlay-protocol record anchored to Zcash mainnet. It is not
          a native Zcash Shielded Asset. Future ZSA migration is a versioned policy, not a
          present-day consensus guarantee.
        </p>
      </section>

      <section id="proofs" className="section shell">
        <div className="sectionhead">
          <div className="eyebrow">PUBLIC LEDGER</div>
          <h2>Recent ZApp Proofs</h2>
        </div>
        <RecentProofs />
      </section>

      <footer className="footer shell">
        <span>ZApp Protocol v1</span>
        <span>Solana burn → Zcash proof</span>
      </footer>
    </main>
  );
}

async function RecentProofs() {
  return (
    <div className="proof-placeholder">
      <p>The explorer populates from the canonical indexer once DATABASE_URL and the mainnet indexer are running.</p>
      <a className="textlink" href="/explorer">Open explorer →</a>
    </div>
  );
}
