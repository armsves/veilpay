import type { Metadata } from "next";
import { Fraunces, Outfit } from "next/font/google";
import { WalletProvider } from "@/components/WalletProvider";
import { PollarAppProvider } from "@/components/PollarAppProvider";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Veilpay — Private payroll on Stellar",
  description:
    "Stealth addresses, confidential payroll, solvency-guarded pools, and Pollar Sandbox cross-border ramps.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${outfit.variable} antialiased`}
        style={
          {
            "--font-display": "var(--font-fraunces)",
            "--font-body": "var(--font-outfit)",
          } as React.CSSProperties
        }
      >
        <WalletProvider>
          <PollarAppProvider>{children}</PollarAppProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
