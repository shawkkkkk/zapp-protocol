"use client";

import { UnifiedWalletButton, useUnifiedWallet } from "@jup-ag/wallet-adapter";

export function ZAppWalletButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { wallet, publicKey } = useUnifiedWallet();

  return (
    <div className={compact ? "wallet-connect compact" : "wallet-connect"}>
      <UnifiedWalletButton
        buttonClassName="wallet wallet-main"
        currentUserClassName="wallet wallet-main connected"
        overrideContent={
          <div className="wallet-button-content">
            <span className="wallet-dot" />
            <span>
              {wallet?.adapter?.connected && publicKey
                ? publicKey.toBase58().slice(0, 4) +
                  "…" +
                  publicKey.toBase58().slice(-4)
                : "Connect wallet"}
            </span>
          </div>
        }
      />
      {!compact && (
        <div className="wallet-options-copy">
          <span>Phantom</span>
          <span>MetaMask</span>
          <span>Jupiter</span>
          <span>Trust</span>
          <span>OKX</span>
          <span>+ more</span>
        </div>
      )}
    </div>
  );
}
