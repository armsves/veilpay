"use client";

import clsx from "clsx";

export type CoverageTrafficLightProps = {
  /** B/L ratio. `1` = fully covered. `null` = unknown. `Infinity` = no liabilities. */
  ratio: number | null;
  /** Pool panic halt (force_panic / halt_if_insolvent). */
  panicHalt?: boolean;
  /** Compact = horizontal lamps only. */
  compact?: boolean;
  className?: string;
};

/**
 * Traffic light for pool solvency:
 * - green  — ratio ≥ 1 and not halted
 * - amber  — WouldUnbalance / halted while still covered, or undercovered before halt
 * - red    — ratio < 1 AND halted
 */
export function coverageLevel(
  ratio: number | null,
  panicHalt?: boolean,
): "red" | "amber" | "green" | "off" {
  if (ratio == null || Number.isNaN(ratio)) return "off";
  const covered = !Number.isFinite(ratio) || ratio >= 1;
  if (!covered && panicHalt) return "red";
  if (panicHalt || !covered) return "amber";
  return "green";
}

export function formatCoverageRatio(ratio: number | null): string {
  if (ratio == null || Number.isNaN(ratio)) return "—";
  if (!Number.isFinite(ratio)) return "∞";
  return `${ratio.toFixed(2)}×`;
}

function levelLabel(ratio: number | null, panicHalt: boolean | undefined, level: ReturnType<typeof coverageLevel>) {
  if (level === "red" || (level === "amber" && panicHalt)) return "HALT";
  return formatCoverageRatio(ratio);
}

function levelHint(
  level: ReturnType<typeof coverageLevel>,
  ratio: number | null,
  panicHalt?: boolean,
) {
  const covered = ratio != null && !Number.isNaN(ratio) && (!Number.isFinite(ratio) || ratio >= 1);
  switch (level) {
    case "green":
      return "Ratio ≥ 1 · not halted";
    case "amber":
      if (panicHalt && covered) return "WouldUnbalance · halted";
      if (!covered) return "Unbalance · ratio < 1";
      return "WouldUnbalance · halted";
    case "red":
      return "Unbalance · ratio < 1 · halted";
    default:
      return "Awaiting pool state";
  }
}

/**
 * Traffic light for pool coverage (confidential + payroll).
 */
export function CoverageTrafficLight({
  ratio,
  panicHalt,
  compact,
  className,
}: CoverageTrafficLightProps) {
  const level = coverageLevel(ratio, panicHalt);
  const label = levelLabel(ratio, panicHalt, level);

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
        <p className="mt-1 text-xs text-[var(--cream-dim)]">{levelHint(level, ratio, panicHalt)}</p>
      </div>
    </div>
  );
}
