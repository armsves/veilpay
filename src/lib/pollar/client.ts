/**
 * Veilpay × Pollar — TestNet ramps (SEP-24 / REST providers).
 *
 * Docs: https://docs.pollar.xyz/docs/core-concepts/ramps
 * Dashboard: dashboard.pollar.xyz → Ramps → Providers (enable Anclap / Sandbox sell)
 *
 * Live corridors come from the Pollar API (`/api/pollar/routes`), not this list.
 * The list below is the operator checklist for typical LATAM sandbox corridors.
 */

/** Pollar Sandbox ARS on Stellar testnet (issuer from live ramp routes). */
export const POLLAR_SANDBOX_ARS = {
  code: "ARS",
  issuer: "GCLAJ3NUQJPUIXMOP6EEQOOK556X6JUBSQEDGIYN2QD4MBEF3EVKCMDR",
} as const;

export type RampDirection = "onramp" | "offramp";

export type PollarSandboxCorridor = {
  id: string;
  direction: "buy" | "sell";
  country: "AR" | "PE" | "BR" | "MX";
  fiat: "ARS" | "PEN" | "BRL" | "MXN";
  rail: "SEP_24" | "REST";
  provider: string;
  note: string;
};

/** Typical TestNet corridors — enable matching Sell routes in the dashboard. */
export const pollarSandboxCorridors: PollarSandboxCorridor[] = [
  {
    id: "sell-ars",
    direction: "sell",
    country: "AR",
    fiat: "ARS",
    rail: "SEP_24",
    provider: "pollar-sandbox",
    note: "ARS on Stellar → ARS fiat (hosted Sandbox)",
  },
  {
    id: "sell-pen",
    direction: "sell",
    country: "PE",
    fiat: "PEN",
    rail: "SEP_24",
    provider: "pollar-sandbox",
    note: "PEN on Stellar → PEN fiat (hosted Sandbox)",
  },
  {
    id: "buy-ars",
    direction: "buy",
    country: "AR",
    fiat: "ARS",
    rail: "SEP_24",
    provider: "pollar-sandbox",
    note: "Sandbox fiat → ARS on Stellar (test mint / hosted buy)",
  },
  {
    id: "buy-pen",
    direction: "buy",
    country: "PE",
    fiat: "PEN",
    rail: "SEP_24",
    provider: "pollar-sandbox",
    note: "Sandbox fiat → PEN on Stellar",
  },
];

export function hasPollarKey() {
  return Boolean(process.env.NEXT_PUBLIC_POLLAR_KEY?.trim());
}

/**
 * Offramp path for confidential payroll:
 * 1) unwrap confidential → transparent Stellar asset (public amount)
 * 2) send / withdraw to Pollar-registered wallet
 * 3) Pollar KYC + quote + bank payout
 */
export type ConfidentialOfframpPlan = {
  steps: Array<{ id: string; title: string; detail: string }>;
  corridor: PollarSandboxCorridor;
  requiresUnwrap: true;
  provider: string;
};

export function planConfidentialOfframp(opts: {
  fiat: "ARS" | "PEN";
  amountLabel: string;
}): ConfidentialOfframpPlan {
  const corridor = pollarSandboxCorridors.find(
    (c) => c.direction === "sell" && c.fiat === opts.fiat,
  );
  if (!corridor) throw new Error(`No Pollar sell corridor template for ${opts.fiat}`);

  return {
    requiresUnwrap: true,
    provider: corridor.provider,
    corridor,
    steps: [
      {
        id: "unwrap",
        title: "Unwrap confidential balance",
        detail: `Withdraw ${opts.amountLabel} from the solvency-gated confidential pool to transparent Stellar (amount becomes public at the boundary).`,
      },
      {
        id: "fund-pollar",
        title: "Fund Pollar wallet",
        detail: "Send the unwrapped asset to the user's Pollar-registered G… address.",
      },
      {
        id: "pollar-kyc",
        title: "Complete KYC",
        detail: "Pass identity verification required by the sell corridor.",
      },
      {
        id: "pollar-offramp",
        title: "One-click bank cash-out",
        detail: `Quote + create offramp order; enter bank details; Pollar settles ${opts.fiat} to the user's account.`,
      },
    ],
  };
}

export function pollarIntegrationStatus() {
  return {
    configured: hasPollarKey(),
    network: "testnet" as const,
    provider: "Pollar ramps (Anclap / dashboard providers)",
    corridors: pollarSandboxCorridors,
    dashboardHint: "dashboard.pollar.xyz → Ramps → Providers → enable Sell corridors",
    sdk: "@pollar/react / @pollar/core ≥ 0.12",
    docs: "https://docs.pollar.xyz/docs/core-concepts/ramps",
  };
}
