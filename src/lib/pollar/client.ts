/**
 * Veilpay × Pollar — testnet Sandbox ramps (SEP-24).
 *
 * Dashboard: TestNet → Ramps → Providers → "Pollar Sandbox" (ARS / PEN).
 * Docs: https://docs.pollar.xyz/docs/core-concepts/ramps
 *
 * No mock bank — Pollar Sandbox is the fiat on/off-ramp on Stellar testnet.
 */

export type RampDirection = "onramp" | "offramp";

export type PollarSandboxCorridor = {
  id: string;
  direction: "buy" | "sell";
  country: "AR" | "PE";
  fiat: "ARS" | "PEN";
  rail: "SEP_24";
  provider: "pollar-sandbox";
  note: string;
};

/** Mirrors enabled corridors on Pollar Sandbox (TestNet). */
export const pollarSandboxCorridors: PollarSandboxCorridor[] = [
  {
    id: "buy-ars",
    direction: "buy",
    country: "AR",
    fiat: "ARS",
    rail: "SEP_24",
    provider: "pollar-sandbox",
    note: "ARS → ARS on Stellar (no FX)",
  },
  {
    id: "sell-ars",
    direction: "sell",
    country: "AR",
    fiat: "ARS",
    rail: "SEP_24",
    provider: "pollar-sandbox",
    note: "ARS on Stellar → ARS fiat (no FX)",
  },
  {
    id: "buy-pen",
    direction: "buy",
    country: "PE",
    fiat: "PEN",
    rail: "SEP_24",
    provider: "pollar-sandbox",
    note: "PEN → PEN on Stellar (no FX)",
  },
  {
    id: "sell-pen",
    direction: "sell",
    country: "PE",
    fiat: "PEN",
    rail: "SEP_24",
    provider: "pollar-sandbox",
    note: "PEN on Stellar → PEN fiat (no FX)",
  },
];

export function hasPollarKey() {
  return Boolean(process.env.NEXT_PUBLIC_POLLAR_KEY?.trim());
}

/**
 * Offramp path for confidential payroll:
 * 1) unwrap confidential → transparent Stellar asset (public amount)
 * 2) open Pollar Sandbox SEP-24 sell corridor (ARS/PEN)
 */
export type ConfidentialOfframpPlan = {
  steps: Array<{ id: string; title: string; detail: string }>;
  corridor: PollarSandboxCorridor;
  requiresUnwrap: true;
  provider: "pollar-sandbox";
};

export function planConfidentialOfframp(opts: {
  fiat: "ARS" | "PEN";
  amountLabel: string;
}): ConfidentialOfframpPlan {
  const corridor = pollarSandboxCorridors.find(
    (c) => c.direction === "sell" && c.fiat === opts.fiat,
  );
  if (!corridor) throw new Error(`No Pollar Sandbox sell corridor for ${opts.fiat}`);

  return {
    requiresUnwrap: true,
    provider: "pollar-sandbox",
    corridor,
    steps: [
      {
        id: "unwrap",
        title: "Unwrap confidential balance",
        detail: `Withdraw ${opts.amountLabel} from the solvency-gated confidential pool to transparent Stellar ${opts.fiat} (amount becomes public at the boundary).`,
      },
      {
        id: "pollar-quote",
        title: "Quote Pollar Sandbox",
        detail: `SEP-24 sell ${opts.fiat} → ${opts.fiat} via Pollar Sandbox on TestNet.`,
      },
      {
        id: "pollar-hosted",
        title: "Complete hosted offramp",
        detail: "User finishes KYC / payout details inside the Pollar / anchor hosted flow.",
      },
    ],
  };
}

/** Soft integration helper — opens docs when SDK key missing. */
export function pollarIntegrationStatus() {
  return {
    configured: hasPollarKey(),
    network: "testnet" as const,
    provider: "Pollar Sandbox",
    corridors: pollarSandboxCorridors,
    dashboardHint: "dashboard.pollar.xyz → TestNet → Ramps → Pollar Sandbox",
    sdk: "@pollar/react / @pollar/core ≥ 0.12",
    docs: "https://docs.pollar.xyz/docs/core-concepts/ramps",
  };
}
