import { ImageResponse } from "next/og";
import { getAsset, getClaim, getNftMint } from "@/lib/server/db";

export const runtime = "nodejs";
export const alt = "ZApp Proof of Destruction";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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

function short(value: string, front = 9, back = 7): string {
  if (value.length <= front + back + 1) return value;
  return value.slice(0, front) + "…" + value.slice(-back);
}

export default async function Image({
  params,
}: {
  params: Promise<{ burnId: string }>;
}) {
  const { burnId } = await params;
  const claim = /^[0-9a-f]{64}$/i.test(burnId)
    ? await getClaim(burnId.toLowerCase())
    : null;

  if (!claim) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            background: "#090807",
            color: "#fff7df",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 56,
          }}
        >
          ZApp ◈ Proof not found
        </div>
      ),
      size,
    );
  }

  const [asset, nft] = await Promise.all([
    getAsset(claim.mint),
    getNftMint(claim.burn_id),
  ]);
  const amount = formatBaseUnits(
    claim.amount_base_units,
    asset?.decimals ?? 0,
  );
  const symbol = asset?.symbol ? "$" + asset.symbol : "SPL TOKEN";
  const verified = Boolean(
    claim.status === "confirmed" &&
      nft?.status === "confirmed" &&
      nft?.indexer_verified_at &&
      nft?.reveal_txid === claim.zcash_txid,
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#090807",
          color: "#fff7df",
          padding: "58px 64px",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            border: "2px solid #4f4019",
            padding: "42px 48px",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div
              style={{
                display: "flex",
                color: "#f4b728",
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: "0.12em",
              }}
            >
              ZAPP ◈ PROOF OF DESTRUCTION
            </div>
            <div
              style={{
                display: "flex",
                border: "2px solid #f4b728",
                color: verified ? "#f4b728" : "#8f8161",
                padding: "11px 16px",
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: "0.12em",
                transform: "rotate(-3deg)",
              }}
            >
              {verified ? "VERIFIED" : "PENDING"}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 52,
              color: "#a99f84",
              fontSize: 18,
              letterSpacing: "0.1em",
            }}
          >
            QUANTITY DESTROYED
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontSize: amount.length > 16 ? 72 : 102,
              fontWeight: 800,
              letterSpacing: "-0.06em",
              lineHeight: 0.95,
            }}
          >
            {amount}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 12,
              color: "#f4b728",
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            {symbol}
          </div>

          <div
            style={{
              display: "flex",
              marginTop: "auto",
              borderTop: "1px solid #4f4019",
              paddingTop: 22,
              justifyContent: "space-between",
              color: "#a99f84",
              fontSize: 17,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span>DESTROYED ON SOLANA</span>
              <span style={{ color: "#e7dcc0", marginTop: 5 }}>
                {short(claim.solana_signature)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span>RECORDED ON ZCASH</span>
              <span style={{ color: "#e7dcc0", marginTop: 5 }}>
                {nft?.reveal_txid ? short(nft.reveal_txid) : "pending"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span>CLAIM</span>
              <span style={{ color: "#e7dcc0", marginTop: 5 }}>
                {short(claim.burn_id)}
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
