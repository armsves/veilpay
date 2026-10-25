"use client";

import { PollarCashOut } from "@/components/PollarCashOut";
import { pollarIntegrationStatus } from "@/lib/pollar/client";

export default function CrossBorderPage() {
  const status = pollarIntegrationStatus();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="display text-2xl leading-none tracking-tight sm:text-3xl">Cash out</h1>
          <p className="mt-0.5 truncate text-xs text-[var(--cream-dim)] sm:text-sm">
            Pollar Sandbox · wallet · KYC · ARS bank offramp
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {status.configured ? (
            <span className="pill pill-ok !py-0.5 text-[10px]">Key set</span>
          ) : (
            <span className="pill pill-danger !py-0.5 text-[10px]">Key missing</span>
          )}
          <a
            className="btn btn-ghost !px-2.5 !py-1 text-xs"
            href="https://dashboard.pollar.xyz"
            target="_blank"
            rel="noreferrer"
          >
            Dashboard
          </a>
        </div>
      </div>

      <PollarCashOut />
    </div>
  );
}
