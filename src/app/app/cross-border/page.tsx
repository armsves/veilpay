"use client";

import { pollarSandboxCorridors, pollarIntegrationStatus } from "@/lib/pollar/client";
import { OpenPollarRamp } from "@/components/OpenPollarRamp";

export default function CrossBorderPage() {
  const status = pollarIntegrationStatus();

  return (
    <div className="space-y-8">
      <div>
        <p className="pill mb-3">Pollar Sandbox · TestNet</p>
        <h1 className="display text-4xl tracking-tight">Cross-border</h1>
        <p className="mt-3 max-w-2xl text-[var(--cream-dim)]">
          Fiat on/off-ramps via Pollar Sandbox SEP-24 (ARS / PEN). No mock bank.
        </p>
      </div>

      <div className="panel p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="display text-2xl">Integration status</h2>
          {status.configured ? (
            <span className="pill pill-ok">API key set</span>
          ) : (
            <span className="pill">Add NEXT_PUBLIC_POLLAR_KEY</span>
          )}
        </div>
        <p className="mt-3 text-sm text-[var(--cream-dim)]">{status.dashboardHint}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <OpenPollarRamp label="Open Pollar Sandbox ramp" />
          <a
            className="btn btn-ghost"
            href="https://dashboard.pollar.xyz"
            target="_blank"
            rel="noreferrer"
          >
            Dashboard
          </a>
        </div>
      </div>

      <div>
        <h2 className="display mb-4 text-2xl">Sandbox corridors</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {pollarSandboxCorridors.map((c) => (
            <div key={c.id} className="panel p-5">
              <div className="flex items-center justify-between">
                <span className="pill">{c.direction}</span>
                <span className="text-sm text-[var(--cream-dim)]">
                  {c.country} · {c.rail}
                </span>
              </div>
              <p className="display mt-3 text-xl">{c.fiat}</p>
              <p className="mt-2 text-sm text-[var(--cream-dim)]">{c.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
