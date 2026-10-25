/**
 * Veilpay Stealth — MAINNET path
 * Aurora / NEAR Confidential Intents (unlink deposit ↔ withdraw).
 *
 * Docs: https://docs.intents.aurora.dev/intents-swap/confidential-swaps
 * Quote: POST https://intents-api.aurora.dev/api/quote/{API_KEY}
 *
 * Stellar origins require depositMode: "MEMO" and the HOT nep245 asset id.
 */

import { z } from "zod";

export const confidentialityMode = z.enum(["public", "basic", "advanced"]);
export type ConfidentialityMode = z.infer<typeof confidentialityMode>;

/** HOT Omni Stellar USDC (pubnet) — from Aurora /api/tokens */
export const STELLAR_USDC_ASSET =
  "nep245:v2_1.omni.hot.tg:1100_111bzQBB65GxAPAVoxqmMcgYo5oS3txhqs1Uh1cgahKQUeTUq1TJu";

/** HOT Omni Stellar XLM (pubnet) */
export const STELLAR_XLM_ASSET =
  "nep245:v2_1.omni.hot.tg:1100_111bzQBB5v7AhLyPMDwS8uJgQV24KaAPXtwyVWu2KXbbfQU6NXRCz";

/** Base native USDC */
export const BASE_USDC_ASSET =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export type IntentsQuoteRequest = {
  originAsset: string;
  destinationAsset: string;
  amount: string;
  recipient: string;
  refundTo: string;
  confidentiality: ConfidentialityMode;
  deadlineIso: string;
  slippageTolerance?: number;
  depositMode?: "SIMPLE" | "MEMO";
  refundType?: "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
};

export type IntentsQuote = {
  depositAddress: string;
  memo?: string;
  amountIn: string;
  amountInFormatted?: string;
  amountOut: string;
  amountOutFormatted?: string;
  confidentiality: ConfidentialityMode;
  correlationId: string;
  note: string;
};

const auroraBase =
  process.env.AURORA_INTENTS_API_URL ?? "https://intents-api.aurora.dev";

export function getAuroraApiKey() {
  return (
    process.env.AURORA_INTENTS_API_KEY?.trim() ||
    process.env.NEAR_INTENTS_JWT?.trim() ||
    ""
  );
}

function isStellarAsset(assetId: string) {
  return assetId.includes("omni.hot.tg") || assetId.includes("stellar");
}

export function buildConfidentialQuoteBody(req: IntentsQuoteRequest) {
  const stellar = isStellarAsset(req.originAsset);
  return {
    dry: false,
    swapType: "EXACT_INPUT" as const,
    originAsset: req.originAsset,
    depositType: "ORIGIN_CHAIN" as const,
    depositMode: req.depositMode ?? (stellar ? "MEMO" : "SIMPLE"),
    destinationAsset: req.destinationAsset,
    amount: req.amount,
    recipient: req.recipient,
    recipientType: "DESTINATION_CHAIN" as const,
    refundTo: req.refundTo,
    refundType: req.refundType ?? (stellar ? "INTENTS" : "ORIGIN_CHAIN"),
    confidentiality: req.confidentiality === "public" ? "public" : req.confidentiality,
    slippageTolerance: req.slippageTolerance ?? 100,
    deadline: req.deadlineIso,
  };
}

export async function quoteConfidentialStealthTransfer(
  partial: Omit<IntentsQuoteRequest, "deadlineIso"> & { deadlineIso?: string },
): Promise<IntentsQuote> {
  const deadlineIso =
    partial.deadlineIso ?? new Date(Date.now() + 30 * 60_000).toISOString();
  const body = buildConfidentialQuoteBody({ ...partial, deadlineIso });
  const apiKey = getAuroraApiKey();

  if (!apiKey) {
    return {
      depositAddress: "GDEMONEARINTENTSTEALTHDEPOSITADDRESS000000000000000",
      memo: "veil-ci-demo",
      amountIn: partial.amount,
      amountOut: partial.amount,
      confidentiality: partial.confidentiality,
      correlationId: `demo-${Date.now()}`,
      note: "Demo quote — set AURORA_INTENTS_API_KEY for live Aurora Intents.",
    };
  }

  const res = await fetch(`${auroraBase}/api/quote/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Aurora Intents returned non-JSON (${res.status}): ${raw.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = String(data.message ?? data.error ?? (raw.slice(0, 300) || res.status));
    throw new Error(`Aurora Intents quote failed (${res.status}): ${msg}`);
  }

  const quote = (data.quote ?? data) as Record<string, unknown>;

  return {
    depositAddress: String(quote.depositAddress ?? quote.deposit_address ?? ""),
    memo: quote.depositMemo
      ? String(quote.depositMemo)
      : quote.memo
        ? String(quote.memo)
        : undefined,
    amountIn: String(quote.amountIn ?? quote.amount_in ?? partial.amount),
    amountInFormatted: quote.amountInFormatted ? String(quote.amountInFormatted) : undefined,
    amountOut: String(quote.amountOut ?? quote.amount_out ?? partial.amount),
    amountOutFormatted: quote.amountOutFormatted ? String(quote.amountOutFormatted) : undefined,
    confidentiality: partial.confidentiality,
    correlationId: String(data.correlationId ?? quote.correlationId ?? quote.id ?? Date.now()),
    note: "Live Aurora confidential XLM quote — send to deposit address + memo; payout hits your Freighter wallet",
  };
}

export const mainnetStealthInfo = {
  id: "stealth-mainnet-intents",
  label: "Stealth + Confidential Aurora / NEAR Intents (mainnet)",
  stack: "Stealth meta-address → HOT bridge → Aurora Confidential Intents",
  docs: "https://docs.intents.aurora.dev/intents-swap/confidential-swaps",
} as const;
