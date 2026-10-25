/**
 * Veilpay Stealth — MAINNET path
 * Private receive via stealth meta-address + cash movement through
 * NEAR Confidential Intents (unlink deposit ↔ withdraw across chains).
 *
 * Docs: https://docs.near-intents.org/.../confidential-swaps
 * Stellar ↔ Intents via HOT bridge (memo deposit).
 */

import { z } from "zod";

export const confidentialityMode = z.enum(["public", "basic", "advanced"]);
export type ConfidentialityMode = z.infer<typeof confidentialityMode>;

export type IntentsQuoteRequest = {
  originAsset: string; // e.g. nep141:stellar-usdc...
  destinationAsset: string;
  amount: string; // smallest units
  recipient: string; // destination chain address
  refundTo: string;
  confidentiality: ConfidentialityMode;
  deadlineIso: string;
};

export type IntentsQuote = {
  depositAddress: string;
  memo?: string;
  amountIn: string;
  amountOut: string;
  confidentiality: ConfidentialityMode;
  correlationId: string;
  note: string;
};

const intentsBase =
  process.env.NEAR_INTENTS_API_URL ?? "https://1click.chaindefuser.com";

/**
 * Build a confidential foreign→foreign quote payload.
 * Call from a server route with JWT — never expose secrets in the browser.
 */
export function buildConfidentialQuoteBody(req: IntentsQuoteRequest) {
  return {
    dry: false,
    swapType: "EXACT_INPUT",
    originAsset: req.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: req.destinationAsset,
    amount: req.amount,
    recipient: req.recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: req.refundTo,
    refundType: "ORIGIN_CHAIN",
    confidentiality: req.confidentiality === "public" ? "public" : req.confidentiality,
    deadline: req.deadlineIso,
  };
}

/** Client-safe stub used when JWT is not configured (demo UI). */
export async function quoteConfidentialStealthTransfer(
  partial: Omit<IntentsQuoteRequest, "deadlineIso"> & { deadlineIso?: string },
): Promise<IntentsQuote> {
  const deadlineIso =
    partial.deadlineIso ?? new Date(Date.now() + 30 * 60_000).toISOString();
  const body = buildConfidentialQuoteBody({ ...partial, deadlineIso });

  // Without server credentials we return a structured demo quote.
  if (!process.env.NEAR_INTENTS_JWT) {
    return {
      depositAddress: "GDEMONEARINTENTSTEALTHDEPOSITADDRESS000000000000000",
      memo: "veil-ci-demo",
      amountIn: partial.amount,
      amountOut: partial.amount,
      confidentiality: partial.confidentiality,
      correlationId: `demo-${Date.now()}`,
      note: "Demo quote — set NEAR_INTENTS_JWT to hit 1Click API on mainnet.",
    };
  }

  const res = await fetch(`${intentsBase}/v0/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NEAR_INTENTS_JWT}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`NEAR Intents quote failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    depositAddress: String(data.depositAddress ?? data.deposit_address ?? ""),
    memo: data.memo ? String(data.memo) : undefined,
    amountIn: String(data.amountIn ?? partial.amount),
    amountOut: String(data.amountOut ?? partial.amount),
    confidentiality: partial.confidentiality,
    correlationId: String(data.correlationId ?? data.id ?? Date.now()),
    note: "Live NEAR Confidential Intents quote",
  };
}

export const mainnetStealthInfo = {
  id: "stealth-mainnet-intents",
  label: "Stealth + Confidential NEAR Intents (mainnet)",
  stack: "Stealth meta-address → HOT bridge → Confidential Intents",
  docs: "https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps",
} as const;
