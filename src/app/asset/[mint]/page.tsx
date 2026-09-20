import { notFound } from "next/navigation";
import { Launchpad } from "@/components/Launchpad";
import { getAsset } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export default async function AssetPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const asset = await getAsset(mint);
  if (!asset) notFound();

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <a className="textlink" href="/explorer">Explorer →</a>
      </nav>
      <section className="assethero shell">
        <div className="assetavatar large">
          {asset.image_url ? <img src={asset.image_url} alt="" /> : <span>{asset.symbol.slice(0, 2)}</span>}
        </div>
        <div>
          <div className="eyebrow">PUBLIC ZAPP LAUNCH</div>
          <h1>{asset.name} <span>{"$" + asset.symbol}</span></h1>
          <p>{asset.description || "Burn this SPL token and receive its corresponding collectible on Zcash mainnet."}</p>
          <code>{asset.mint}</code>
        </div>
      </section>
      <Launchpad initialMint={asset.mint} initialSymbol={asset.symbol} hideCreator />
    </main>
  );
}
