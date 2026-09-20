import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAsset, getClaim, getNftMint } from "@/lib/server/db";

export const dynamic = "force-dynamic";

function formatBaseUnits(raw: string, decimals: number): string {
  const amount = BigInt(raw || "0");
  if (decimals <= 0) return amount.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

function short(value: string, front = 8, back = 6): string {
  if (value.length <= front + back + 1) return value;
  return value.slice(0, front) + "…" + value.slice(-back);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ burnId: string }>;
}): Promise<Metadata> {
  const { burnId } = await params;
  if (!/^[0-9a-f]{64}$/i.test(burnId)) return { title: "ZApp Proof" };

  const claim = await getClaim(burnId.toLowerCase());
  if (!claim) return { title: "ZApp Proof" };
  const asset = await getAsset(claim.mint);
  const amount = formatBaseUnits(
    claim.amount_base_units,
    asset?.decimals ?? 0,
  );
  const symbol = asset?.symbol ? " $" + asset.symbol : "";

  const origin =
    process.env.ZAPP_CANONICAL_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://zapp-web-production.up.railway.app";
  const url = origin.replace(/\/$/, "") + "/proof/" + claim.burn_id;
  const title = `${amount}${symbol} destroyed — ZApp Proof`;
  const description =
    `${amount}${symbol} was destroyed on Solana and recorded on Zcash through ZApp.`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "ZApp",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ProofPage({
  params,
}: {
  params: Promise<{ burnId: string }>;
}) {
  const { burnId } = await params;
  if (!/^[0-9a-f]{64}$/i.test(burnId)) notFound();

  const claim = await getClaim(burnId.toLowerCase());
  if (!claim) notFound();

  const [nft, asset] = await Promise.all([
    getNftMint(claim.burn_id),
    getAsset(claim.mint),
  ]);

  const amount = formatBaseUnits(
    claim.amount_base_units,
    asset?.decimals ?? 0,
  );
  const verified = Boolean(
    claim.status === "confirmed" &&
      nft?.status === "confirmed" &&
      nft?.indexer_verified_at &&
      nft?.reveal_txid === claim.zcash_txid,
  );
  const owner = claim.current_owner || claim.recipient;
  const symbol = asset?.symbol ? "$" + asset.symbol : "SPL TOKEN";
  const origin =
    process.env.ZAPP_CANONICAL_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://zapp-web-production.up.railway.app";
  const proofUrl = origin.replace(/\/$/, "") + "/proof/" + claim.burn_id;
  const shareText = verified
    ? amount + " " + symbol + " destroyed on Solana and independently verified on Zcash via ZApp ◈"
    : amount + " " + symbol + " destroyed on Solana. Zcash verification pending via ZApp ◈";
  const xShareUrl =
    "https://x.com/intent/post?text=" +
    encodeURIComponent(shareText) +
    "&url=" +
    encodeURIComponent(proofUrl);

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="/burn">Burn</a>
          <a href="/#launch">Launch</a>
          <a href="/#register">Register</a>
          <a href="/explorer">Explorer</a>
        </div>
      </nav>

      <section className="proof-page shell">
        <div className="proof-certificate">
          <div className="proof-topline">
            <div>
              <div className="eyebrow">ZAPP PROOF OF DESTRUCTION</div>
              <h1>Certificate of Destruction</h1>
            </div>
            <div className={verified ? "proof-seal verified" : "proof-seal"}>
              {verified ? "VERIFIED" : "PENDING"}
            </div>
          </div>

          <div className="proof-rule" />

          <p className="proof-intro">
            The quantity below was irreversibly destroyed on Solana. ZApp records
            the corresponding claim on Zcash and independently verifies both
            sides of the trail.
          </p>

          <div className="proof-amount">
            <span>Quantity destroyed</span>
            <strong>{amount}</strong>
            <b>{symbol}</b>
          </div>

          <div className="proof-grid">
            <div>
              <span>Delivered to</span>
              <code>{claim.recipient}</code>
            </div>
            <div>
              <span>Current owner</span>
              <code>{owner}</code>
            </div>
            <div>
              <span>Solana burn</span>
              <code>{claim.solana_signature}</code>
            </div>
            <div>
              <span>Zcash reveal</span>
              <code>{nft?.reveal_txid || claim.zcash_txid || "pending"}</code>
            </div>
            <div>
              <span>Inscription</span>
              <code>{nft?.inscription_id || "pending"}</code>
            </div>
            <div>
              <span>Claim ID</span>
              <code>{claim.burn_id}</code>
            </div>
          </div>

          <div className="proof-verification">
            <div>
              <span className={claim.status === "confirmed" ? "check on" : "check"} />
              <p>
                <b>Solana burn verified</b>
                <small>
                  Finalized BurnChecked evidence matched the registered mint,
                  amount, signer and committed Zcash address.
                </small>
              </p>
            </div>
            <div>
              <span className={nft?.status === "confirmed" ? "check on" : "check"} />
              <p>
                <b>Zcash inscription confirmed</b>
                <small>
                  The reveal transaction contains the canonical ZApp NFT content
                  and proof carrier.
                </small>
              </p>
            </div>
            <div>
              <span className={nft?.indexer_verified_at ? "check on" : "check"} />
              <p>
                <b>Independent indexer verified</b>
                <small>
                  The reveal envelope, P2SH commit lineage and Solana burn were
                  reconstructed independently.
                </small>
              </p>
            </div>
          </div>

          <div className="proof-footerline">
            <span>
              Issued {new Date(claim.created_at).toLocaleDateString("en-US")}
            </span>
            <span>Burn {short(claim.burn_id)}</span>
          </div>
        </div>

        <aside className="proof-side">
          <div>
            <span>Asset</span>
            <a href={"/asset/" + claim.mint}>
              {asset?.name || short(claim.mint)} · {symbol}
            </a>
          </div>
          <div>
            <span>Network</span>
            <b>Solana → Zcash mainnet</b>
          </div>
          <div>
            <span>NFT status</span>
            <b>{nft?.status || "not queued"}</b>
          </div>
          <div>
            <span>Indexer</span>
            <b>{nft?.indexer_verified_at ? "verified" : "pending"}</b>
          </div>
          {nft?.indexer_verified_height && (
            <div>
              <span>Zcash block</span>
              <b>{nft.indexer_verified_height}</b>
            </div>
          )}
          <div className="proof-actions">
            <a href={xShareUrl} target="_blank" rel="noreferrer">
              Share proof on X ↗
            </a>
            <a href={proofUrl}>Permanent proof link ↗</a>
          </div>
          <p>
            ZApp proofs are public inscription/NFT claim objects. They are not
            native shielded Zcash assets.
          </p>
        </aside>
      </section>
    </main>
  );
}
