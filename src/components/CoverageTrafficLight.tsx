"use client";

import clsx from "clsx";

export type CoverageTrafficLightProps = {
  /** B/L ratio. `1` = fully covered (green). `null` = unknown. `Infinity` = no liabilities. */
  ratio: number | null;
  /** Panic halt overrides to red. */
  panicHalt?: boolean;
  /** Compact = horizontal lamps only. */
  compact?: boolean;
  className?: string;
};

export function coverageLevel(
  ratio: number | null,
  panicHalt?: boolean,
): "red" | "amber" | "green" | "off" {
  if (panicHalt) return "red";
  if (ratio == null || Number.isNaN(ratio)) return "off";
  if (!Number.isFinite(ratio)) return "green"; // L = 0
  if (ratio >= 1) return "green";
  if (ratio >= 0.95) return "amber";
  return "red";
}

export function formatCoverageRatio(ratio: number | null): string {
  if (ratio == null || Number.isNaN(ratio)) return "—";
  if (!Number.isFinite(ratio)) return "∞";
  return `${ratio.toFixed(2)}×`;
}

/**
 * Traffic light for pool coverage. Green at ratio ≥ 1 (B ≥ L).
 */
export function CoverageTrafficLight({
  ratio,
  panicHalt,
  compact,
  className,
}: CoverageTrafficLightProps) {
  const level = coverageLevel(ratio, panicHalt);
  const label = panicHalt ? "PANIC" : formatCoverageRatio(ratio);

  const lamps = (
    <div
      className={clsx(
        "flex items-center gap-1.5 rounded-full bg-black/35 p-1.5",
        compact ? "flex-row" : "flex-col",
      )}
      role="img"
      aria-label={`Coverage ${label}, signal ${level}`}
    >
      {(
        [
          { id: "red", color: "bg-[var(--danger)]", on: level === "red" },
          { id: "amber", color: "bg-[var(--amber)]", on: level === "amber" },
          { id: "green", color: "bg-[var(--ok)]", on: level === "green" },
        ] as const
      ).map((lamp) => (
        <span
          key={lamp.id}
          className={clsx(
            "block size-3 rounded-full transition-all duration-300 sm:size-3.5",
            lamp.on
              ? clsx(lamp.color, "opacity-100 shadow-[0_0_10px_currentColor] scale-110")
              : "bg-[var(--cream)] opacity-15",
          )}
        />
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className={clsx("inline-flex items-center gap-2", className)}>
        {lamps}
        <span
          className={clsx(
            "display text-lg leading-none",
            level === "green" && "text-[var(--ok)]",
            level === "amber" && "text-[var(--amber)]",
            level === "red" && "text-[var(--danger)]",
          )}
        >
          {label}
        </span>
      </div>
    );
  }

  return (
    <div className={clsx("flex items-center gap-4", className)}>
      {lamps}
      <div>
        <p className="text-sm text-[var(--cream-dim)]">Coverage ratio</p>
        <p
          className={clsx(
            "display text-3xl leading-tight",
            level === "green" && "text-[var(--ok)]",
            level === "amber" && "text-[var(--amber)]",
            level === "red" && "text-[var(--danger)]",
          )}
        >
          {label}
        </p>
        <p className="mt-1 text-xs text-[var(--cream-dim)]">
          {level === "green"
            ? "B ≥ L · solvent"
            : level === "amber"
              ? "Near floor · watch"
              : level === "red"
                ? panicHalt
                  ? "Panic halt"
                  : "B < L · undercovered"
                : "Awaiting pool state"}
        </p>
      </div>
    </div>
  );
}
