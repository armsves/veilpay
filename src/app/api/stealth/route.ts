import { NextResponse } from "next/server";
import nacl from "tweetnacl";
import {
  deriveStealthKeysFromSeed,
  encodeMetaAddress,
  decodeMetaAddress,
  generateStealthPayment,
  matchesAnnouncement,
} from "@/lib/stealth/testnet";
import { quoteConfidentialStealthTransfer } from "@/lib/stealth/mainnet-intents";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action: string;
    seedHex?: string;
    meta?: string;
    ephemeralPubKey?: string;
    viewTag?: number;
    amount?: string;
    recipient?: string;
    refundTo?: string;
    confidentiality?: "public" | "basic" | "advanced";
  };

  switch (body.action) {
    case "create_testnet_meta": {
      const seed = body.seedHex
        ? Uint8Array.from(Buffer.from(body.seedHex, "hex"))
        : nacl.randomBytes(32);
      const keys = deriveStealthKeysFromSeed(seed);
      const meta = encodeMetaAddress(keys.spending.publicKey, keys.viewing.publicKey);
      return NextResponse.json({
        ok: true,
        network: "testnet",
        meta,
        seedHex: Buffer.from(seed).toString("hex"),
        viewingSecretKey: Buffer.from(keys.viewing.secretKey).toString("base64"),
        info: "Keep viewing/spending secrets client-side in production.",
      });
    }
    case "generate_payment": {
      if (!body.meta) return NextResponse.json({ ok: false, error: "meta required" }, { status: 400 });
      const meta = decodeMetaAddress(body.meta);
      const payment = generateStealthPayment(meta);
      return NextResponse.json({ ok: true, network: "testnet", payment });
    }
    case "scan": {
      if (!body.ephemeralPubKey || body.viewTag === undefined || !body.meta) {
        return NextResponse.json({ ok: false, error: "missing scan fields" }, { status: 400 });
      }
      const meta = decodeMetaAddress(body.meta);
      // Demo: caller must pass viewing secret via header in real app — here we reject.
      return NextResponse.json({
        ok: false,
        error: "Scan with viewing key client-side only",
        hint: "Use matchesAnnouncement in the browser with the viewing secret.",
        metaSpend: meta.spendingPubKey,
      }, { status: 400 });
    }
    case "mainnet_intents_quote": {
      const quote = await quoteConfidentialStealthTransfer({
        originAsset: "nep141:stellar.usdc.hot.tg",
        destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
        amount: body.amount ?? "1000000",
        recipient: body.recipient ?? "0xRecipient",
        refundTo: body.refundTo ?? "GREFUND",
        confidentiality: body.confidentiality ?? "basic",
      });
      return NextResponse.json({ ok: true, network: "mainnet", quote });
    }
    default:
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    modules: [
      {
        id: "stealth-testnet",
        network: "testnet",
        description: "DKSAP-style stealth + SPP-compatible stack",
        docs: "https://developers.stellar.org/docs/build/apps/privacy",
      },
      {
        id: "stealth-mainnet-intents",
        network: "mainnet",
        description: "Stealth receive + NEAR Confidential Intents unlinkability",
        docs: "https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps",
      },
    ],
  });
}

// silence unused import in edge cases
void matchesAnnouncement;
