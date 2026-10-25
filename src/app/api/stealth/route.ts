import { NextResponse } from "next/server";
import nacl from "tweetnacl";
import {
  deriveStealthKeysFromSeed,
  encodeMetaAddress,
  decodeMetaAddress,
  generateStealthPayment,
  matchesAnnouncement,
} from "@/lib/stealth/testnet";
import {
  STELLAR_XLM_ASSET,
  quoteConfidentialStealthTransfer,
} from "@/lib/stealth/mainnet-intents";

export async function POST(req: Request) {
  let body: {
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

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  try {
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
        if (!body.meta) {
          return NextResponse.json({ ok: false, error: "meta required" }, { status: 400 });
        }
        const meta = decodeMetaAddress(body.meta);
        const payment = generateStealthPayment(meta);
        return NextResponse.json({ ok: true, network: "testnet", payment });
      }
      case "scan": {
        if (!body.ephemeralPubKey || body.viewTag === undefined || !body.meta) {
          return NextResponse.json({ ok: false, error: "missing scan fields" }, { status: 400 });
        }
        const meta = decodeMetaAddress(body.meta);
        return NextResponse.json(
          {
            ok: false,
            error: "Scan with viewing key client-side only",
            hint: "Use matchesAnnouncement in the browser with the viewing secret.",
            metaSpend: meta.spendingPubKey,
          },
          { status: 400 },
        );
      }
      case "mainnet_intents_quote": {
        const recipient = body.recipient?.trim();
        if (!recipient || !recipient.startsWith("G") || recipient.length < 56) {
          return NextResponse.json(
            { ok: false, error: "Connect Freighter — recipient must be your Stellar G… address" },
            { status: 400 },
          );
        }
        // Confidential XLM in → XLM out to the connected Freighter wallet.
        // Deposit address (+ memo) is the one-time input; payout = recipient.
        const quote = await quoteConfidentialStealthTransfer({
          originAsset: STELLAR_XLM_ASSET,
          destinationAsset: STELLAR_XLM_ASSET,
          amount: body.amount ?? "50000000", // 5 XLM (7 decimals)
          recipient,
          refundTo: body.refundTo ?? "relay.hot.tg",
          confidentiality: body.confidentiality ?? "basic",
          depositMode: "MEMO",
          refundType: "INTENTS",
        });
        return NextResponse.json({
          ok: true,
          network: "mainnet",
          quote: { ...quote, payoutTo: recipient, asset: "XLM" },
        });
      }
      default:
        return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
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
        description: "Stealth receive + Aurora Confidential Intents unlinkability",
        docs: "https://docs.intents.aurora.dev/intents-swap/confidential-swaps",
      },
    ],
  });
}

void matchesAnnouncement;
