import { NextResponse } from "next/server";
import { CONFIDENTIAL_TOKEN_ID } from "@/lib/confidential/config";

/**
 * Same-origin proxy for confidential token stats.
 * Client pages under COEP cannot fetch api.stellar.expert directly.
 */
export async function GET() {
  try {
    const res = await fetch(
      `https://api.stellar.expert/explorer/testnet/contract/${CONFIDENTIAL_TOKEN_ID}`,
      { next: { revalidate: 15 } },
    );
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `expert ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { invocations?: number; events?: number };
    return NextResponse.json({
      ok: true,
      tokenId: CONFIDENTIAL_TOKEN_ID,
      invocations: typeof data.invocations === "number" ? data.invocations : 0,
      events: typeof data.events === "number" ? data.events : 0,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
