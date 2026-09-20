import { notFound } from "next/navigation";
import { Launchpad } from "@/components/Launchpad";
import { getAsset, getAssetStats } from "@/lib/server/db";

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

export default async function AssetPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  const asset = await getAsset(mint);
  if (!asset) notFound();

  const stats = await getAssetStats(mint);
  const burned = formatBaseUnits(stats.burned_base_units, asset.decimals);

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="/">Discover</a>
          <a href="/explorer">Explorer</a>
        </div>
      </nav>

      <section className="assethero shell">
        <div className="assetavatar large">
          {asset.image_url ? (
            <img src={asset.image_url} alt="" />
          ) : (
            <span>{asset.symbol.slice(0, 2)}</span>
          )}
        </div>

        <div>
          <div className="asset-kicker">
            <span className="verified-pill">Verified ZApp launch</span>
            <span>Solana → Zcash</span>
          </div>
          <h1>
            {asset.name} <span>{"$" + asset.symbol}</span>
          </h1>
          <p>
            {asset.description ||
              "Burn this SPL token and receive its corresponding collectible on Zcash mainnet."}
          </p>

          <div className="asset-links">
            {asset.website_url && (
              <a href={asset.website_url} target="_blank" rel="noreferrer">
                Website ↗
              </a>
            )}
            {asset.x_url && (
              <a href={asset.x_url} target="_blank" rel="noreferrer">
                X / Twitter ↗
              </a>
            )}
          </div>

          <div className="mint-line">
            <span>Mint</span>
            <code>{asset.mint}</code>
          </div>
        </div>
      </section>

      <section className="assetstats shell">
        <div>
          <b>{stats.verified_burns}</b>
          <span>Verified burns</span>
        </div>
        <div>
          <b>{burned}</b>
          <span>{"$" + asset.symbol + " burned"}</span>
        </div>
        <div>
          <b>{stats.confirmed_nfts}</b>
          <span>Zcash NFTs confirmed</span>
        </div>
        <div>
          <b>{stats.pending_nfts}</b>
          <span>NFTs minting</span>
        </div>
      </section>

      <section className="asset-origin shell">
        <div>
          <span>Creator</span>
          <code>{asset.creator}</code>
        </div>
        <div>
          <span>Token program</span>
          <code>{asset.token_program}</code>
        </div>
        <div>
          <span>Decimals</span>
          <b>{asset.decimals}</b>
        </div>
        <div>
          <span>Launch slot</span>
          <b>{asset.launch_slot}</b>
        </div>
      </section>

      <Launchpad
        initialMint={asset.mint}
        initialSymbol={asset.symbol}
        hideCreator
      />
    </main>
  );
}
