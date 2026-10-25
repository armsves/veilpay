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
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
        <p className="pill mb-2">Banking overview</p>
        <h1 className="display text-3xl tracking-tight sm:text-4xl">Your private operating account</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-[var(--cream-dim)]">
          Modules are separate by design: stealth (testnet / mainnet-intents), confidential payroll with
          auto-halt, and Pollar TestNet bank cash-out.
        </p>
      </div>

      <div className="grid shrink-0 gap-2.5 sm:grid-cols-3">
        <div className="panel px-4 py-3">
          <p className="text-xs text-[var(--cream-dim)]">Pool assets (B)</p>
          <p className="display mt-1 text-2xl">{solvency?.assetsUsdc ?? "0"} USDC</p>
        </div>
        <div className="panel px-4 py-3">
          <p className="text-xs text-[var(--cream-dim)]">Liabilities (L)</p>
          <p className="display mt-1 text-2xl">{solvency?.liabilitiesUsdc ?? "0"} USDC</p>
        </div>
        <div className="panel flex items-center px-4 py-3">
          <CoverageTrafficLight
            compact
            ratio={solvency == null ? null : solvency.coverage}
            panicHalt={solvency?.panicHalt}
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
            title: "Cash out",
            body: "Pollar account · KYC · one-click offramp to bank (TestNet).",
          },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="panel block p-4 transition hover:border-[rgba(61,186,140,0.35)]"
          >
            <h2 className="display text-xl">{c.title}</h2>
            <p className="mt-1 text-sm text-[var(--cream-dim)]">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
