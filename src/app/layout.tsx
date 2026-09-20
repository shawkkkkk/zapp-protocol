import type { Metadata } from "next";
import { SolanaWalletProvider } from "@/components/SolanaWalletProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZApp — Assets on Zcash, today",
  description:
    "Launch SPL assets, burn on Solana, and receive verifiable collectibles on Zcash mainnet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </body>
    </html>
  );
}
