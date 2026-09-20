"use client";

import {
  UnifiedWalletProvider,
  type WalletName,
} from "@jup-ag/wallet-adapter";

const preferredWallets = [
  "Phantom",
  "MetaMask",
  "Jupiter Wallet",
  "Trust",
  "Trust Wallet",
  "OKX Wallet",
] as WalletName[];

export function SolanaWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://zapp-web-production.up.railway.app";

  return (
    <UnifiedWalletProvider
      wallets={[]}
      localStorageKey="zapp-wallet"
      config={{
        autoConnect: true,
        env: "mainnet-beta",
        metadata: {
          name: "ZApp",
          description: "Launch on Solana. Land on Zcash.",
          url: appUrl,
          iconUrls: [appUrl + "/favicon.ico"],
        },
        theme: "dark",
        lang: "en",
        walletPrecedence: preferredWallets,
        walletModalAttachments: {
          footer: (
            <div className="wallet-modal-note">
              Phantom · MetaMask · Jupiter · Trust Wallet · OKX · and other
              Wallet Standard compatible Solana wallets
            </div>
          ),
        },
      }}
    >
      {children}
    </UnifiedWalletProvider>
  );
}
