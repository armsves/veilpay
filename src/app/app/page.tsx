"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CoverageTrafficLight } from "@/components/CoverageTrafficLight";

type Solvency = {
  assetsUsdc: string;
  liabilitiesUsdc: string;
  coverage: number;
  panicHalt: boolean;
};

export default function OverviewPage() {
  const [solvency, setSolvency] = useState<Solvency | null>(null);

  useEffect(() => {
    fetch("/api/payroll")
      .then((r) => r.json())
      .then((d) => setSolvency(d.solvency))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <p className="pill mb-3">Banking overview</p>
        <h1 className="display text-4xl tracking-tight sm:text-5xl">Your private operating account</h1>
        <p className="mt-3 max-w-2xl text-[var(--cream-dim)]">
          Modules are separate by design: stealth (testnet / mainnet-intents), confidential payroll with
          auto-halt, and Pollar Sandbox cross-border ramps.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel p-5">
          <p className="text-sm text-[var(--cream-dim)]">Pool assets (B)</p>
          <p className="display mt-2 text-3xl">{solvency?.assetsUsdc ?? "0"} USDC</p>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-[var(--cream-dim)]">Liabilities (L)</p>
          <p className="display mt-2 text-3xl">{solvency?.liabilitiesUsdc ?? "0"} USDC</p>
        </div>
        <div className="panel p-5">
          <CoverageTrafficLight
            ratio={solvency == null ? null : solvency.coverage}
            panicHalt={solvency?.panicHalt}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            href: "/app/stealth",
            title: "Stealth names",
            body: "Register you.veil — Fluidkey-style one-time receives.",
          },
          {
            href: "/app/private-pay",
            title: "Private payments",
            body: "Nethermind SPP pool — deposit, private transfer, withdraw.",
          },
          {
            href: "/app/confidential",
            title: "Confidential token",
            body: "OZ register + deposit with solvency Hooks on testnet.",
          },
          {
            href: "/app/payroll",
            title: "Confidential payroll",
            body: "Fund, pay, unwrap with B≥L revert and monitor halt.",
          },
          {
            href: "/app/cross-border",
            title: "Cross-border",
            body: "Pollar Sandbox SEP-24 ARS/PEN — TestNet fiat rails.",
          },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="panel block p-6 transition hover:border-[rgba(61,186,140,0.35)]">
            <h2 className="display text-2xl">{c.title}</h2>
            <p className="mt-2 text-sm text-[var(--cream-dim)]">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
