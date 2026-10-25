"use client";

import { PollarCashOut } from "@/components/PollarCashOut";
import { pollarIntegrationStatus } from "@/lib/pollar/client";

export default function CrossBorderPage() {
  const status = pollarIntegrationStatus();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl tracking-tight">Cash out</h1>
          <p className="mt-0.5 text-sm text-[var(--cream-dim)]">
            Pollar TestNet · register wallet · KYC · one-click bank offramp
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status.configured ? (
            <span className="pill pill-ok">Pollar key set</span>
          ) : (
            <span className="pill pill-danger">Key missing</span>
          )}
          <a
            className="btn btn-ghost !py-1.5 !px-3 text-sm"
            href="https://dashboard.pollar.xyz"
            target="_blank"
            rel="noreferrer"
          >
            Dashboard
          </a>
          <a
            className="btn btn-ghost !py-1.5 !px-3 text-sm"
            href="https://docs.pollar.xyz/docs/core-concepts/ramps"
            target="_blank"
            rel="noreferrer"
          >
            Docs
          </a>
        </div>
      </div>

      <PollarCashOut />
    </div>
  );
}
