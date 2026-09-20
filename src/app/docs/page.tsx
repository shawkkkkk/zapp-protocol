export const dynamic = "force-static";

export default function DocsPage() {
  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="/burn">Burn</a>
          <a href="/#launch">Launch</a>
          <a href="/leaderboard">Leaderboard</a>
          <a href="/status">Status</a>
        </div>
      </nav>

      <section className="docs-page shell">
        <div className="eyebrow">HOW ZAPP WORKS</div>
        <h1>Burn first. Verify everything.</h1>
        <p className="docs-lede">
          ZApp is a cross-chain protocol for turning a finalized SPL token burn
          into a public inscription/NFT on Zcash mainnet. The Solana burn is the
          source of truth for quantity. The Zcash object records the resulting
          claim.
        </p>

        <div className="docs-sections">
          <section>
            <span>01</span>
            <div>
              <h2>Launching an asset</h2>
              <p>
                Creators can make a new fixed-supply SPL token or register a
                compatible existing SPL/Token-2022 mint. Public launches require
                both mint authority and freeze authority to be revoked.
              </p>
              <p>
                Launch metadata is signed by the creator wallet and becomes
                immutable after registration. New ZApp-created tokens also
                publish standard Solana token metadata.
              </p>
            </div>
          </section>

          <section>
            <span>02</span>
            <div>
              <h2>Burning</h2>
              <p>
                A holder signs one Solana transaction containing exactly one
                top-level BurnChecked instruction and a canonical ZApp memo
                committing the Zcash destination.
              </p>
              <div className="docs-warning">
                <b>Burning is permanent.</b>
                <p>
                  ZApp cannot reverse, refund, recreate, or redirect tokens after
                  a successful burn. Review the amount and Zcash destination
                  before signing.
                </p>
              </div>
            </div>
          </section>

          <section>
            <span>03</span>
            <div>
              <h2>Verification</h2>
              <p>
                ZApp independently reads the finalized Solana transaction and
                verifies the burn amount, mint, direct signer, token-account
                owner, pre/post balance delta, and committed destination.
              </p>
              <p>
                A second independent Zcash indexer later reconstructs the reveal
                inscription and P2SH commit lineage before a Proof of Destruction
                receives its verified status.
              </p>
            </div>
          </section>

          <section>
            <span>04</span>
            <div>
              <h2>Zcash inscription / NFT</h2>
              <p>
                The corresponding Zcash object contains canonical JSON describing
                the Solana mint, burn transaction, burn ID, exact raw quantity,
                and committed Zcash recipient. Its compact ZApp proof is also
                carried in the reveal transaction.
              </p>
              <p>
                The inscription/NFT is public. It is not a shielded native Zcash
                asset and does not make the destroyed SPL tokens spendable again.
              </p>
            </div>
          </section>

          <section>
            <span>05</span>
            <div>
              <h2>If the browser closes</h2>
              <p>
                The burn itself remains on Solana. ZApp has a finalized-burn
                recovery path, and the production Solana watcher automatically
                scans registered assets so a valid burn can still be discovered
                and queued even if the user leaves immediately after signing.
              </p>
            </div>
          </section>

          <section>
            <span>06</span>
            <div>
              <h2>Future native assets</h2>
              <p>
                ZApp records evidence that could be used by a future migration
                policy if compatible native Zcash assets are activated. No native
                ZSA exists here today, and no future conversion is guaranteed by
                current Zcash consensus.
              </p>
            </div>
          </section>
        </div>

        <div className="docs-grid">
          <div>
            <span>SUPPORTED SOLANA WALLETS</span>
            <b>Phantom, MetaMask, Jupiter, Trust, OKX + Wallet Standard</b>
          </div>
          <div>
            <span>SUPPORTED DESTINATION</span>
            <b>Zcash mainnet transparent addresses supported by ZApp v1</b>
          </div>
          <div>
            <span>CUSTODY</span>
            <b>ZApp does not custody holder SPL tokens</b>
          </div>
          <div>
            <span>VERIFY</span>
            <b>Every successful claim gets a public Proof of Destruction page</b>
          </div>
        </div>

        <div className="docs-disclaimer">
          <b>Asset risk</b>
          <p>
            Registration means ZApp verified the launch conditions required by
            the protocol. It is not an endorsement of the creator, token value,
            liquidity, legality, security, or future performance of an asset.
          </p>
        </div>
      </section>
    </main>
  );
}
