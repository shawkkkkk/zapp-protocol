import { listAssetsForDiscovery } from "@/lib/server/db";

export const dynamic = "force-dynamic";

function compact(value: string): string {
  const n = BigInt(value || "0");
  if (n >= 1_000_000_000n) return (Number(n / 10_000_000n) / 100).toFixed(2) + "B";
  if (n >= 1_000_000n) return (Number(n / 10_000n) / 100).toFixed(2) + "M";
  if (n >= 1_000n) return (Number(n / 10n) / 100).toFixed(2) + "K";
  return n.toString();
}

export default async function Leaderboard() {
  const [burned, trending, newest] = await Promise.all([
    listAssetsForDiscovery("most-burned", 50),
    listAssetsForDiscovery("trending", 50),
    listAssetsForDiscovery("newest", 50),
  ]);

  const newestRank = new Map(newest.map((asset, index) => [asset.mint, index + 1]));
  const trendingRank = new Map(
    trending.map((asset, index) => [asset.mint, index + 1]),
  );

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="/">ZApp</a>
        <div className="navlinks">
          <a href="/#launch">Launch</a>
          <a href="/#register">Register</a>
          <a href="/leaderboard">Leaderboard</a>
          <a href="/explorer">Explorer</a>
        </div>
      </nav>

      <section className="leaderboard shell">
        <div className="eyebrow">PUBLIC ACTIVITY</div>
        <h1>Leaderboard</h1>
        <p>
          Ranked by total verified token destruction. Trending rank reflects
          recent verified burns and confirmed Zcash inscriptions.
        </p>

        <div className="leaderboard-table">
          <div className="leaderboard-row head">
            <span>#</span>
            <span>Asset</span>
            <span>Burns</span>
            <span>Destroyed</span>
            <span>Zcash NFTs</span>
            <span>Trending</span>
          </div>

          {burned.map((asset, index) => (
            <a
              className="leaderboard-row"
              href={"/asset/" + asset.mint}
              key={asset.mint}
            >
              <strong>{index + 1}</strong>
              <div className="leaderboard-asset">
                <div className="leaderboard-avatar">
                  {asset.image_url ? (
                    <img src={asset.image_url} alt="" />
                  ) : (
                    <span>{asset.symbol.slice(0, 2)}</span>
                  )}
                </div>
                <div>
                  <b>{asset.name}</b>
                  <small>{"$" + asset.symbol}</small>
                </div>
              </div>
              <span>{asset.verified_burns}</span>
              <span>{compact(asset.burned_base_units)}</span>
              <span>{asset.confirmed_nfts}</span>
              <span>
                {trendingRank.get(asset.mint)
                  ? "#" + trendingRank.get(asset.mint)
                  : "—"}
              </span>
            </a>
          ))}

          {!burned.length && (
            <div className="leaderboard-empty">
              No public burns yet. The leaderboard opens with the first verified
              mainnet burn.
            </div>
          )}
        </div>

        <p className="leaderboard-note">
          Newest launch position is recorded independently from activity ranking.
          {newestRank.size ? " " + newestRank.size + " launches indexed." : ""}
        </p>
      </section>
    </main>
  );
}
