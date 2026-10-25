"use client";

import { pollarSandboxCorridors, pollarIntegrationStatus } from "@/lib/pollar/client";
import { OpenPollarRamp } from "@/components/OpenPollarRamp";

export default function CrossBorderPage() {
  const status = pollarIntegrationStatus();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl tracking-tight">Cross-border</h1>
          <p className="mt-0.5 text-sm text-[var(--cream-dim)]">
            Pollar Sandbox SEP-24 · ARS / PEN · no mock bank
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status.configured ? (
            <span className="pill pill-ok">API key set</span>
          ) : (
            <span className="pill">Key missing</span>
          )}
          <OpenPollarRamp label="Open ramp" className="btn btn-primary !py-1.5 !px-3 text-sm" />
          <a
            className="btn btn-ghost !py-1.5 !px-3 text-sm"
            href="https://dashboard.pollar.xyz"
            target="_blank"
            rel="noreferrer"
          >
            Dashboard
          </a>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
        {pollarSandboxCorridors.map((c) => (
          <div key={c.id} className="panel flex min-h-0 flex-col justify-between p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="pill">{c.direction}</span>
              <span className="text-xs text-[var(--cream-dim)]">
                {c.country} · {c.rail}
              </span>
            </div>
            <p className="display mt-3 text-2xl leading-none">{c.fiat}</p>
            <p className="mt-2 text-sm text-[var(--cream-dim)]">{c.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
