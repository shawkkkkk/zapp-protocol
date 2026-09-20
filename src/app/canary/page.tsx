import type { Metadata } from "next";
import { CanaryConsole } from "@/components/CanaryConsole";

export const metadata: Metadata = {
  title: "ZApp Mainnet Canary",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function CanaryPage() {
  return <CanaryConsole />;
}
