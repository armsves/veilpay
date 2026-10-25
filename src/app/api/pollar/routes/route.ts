import { NextResponse } from "next/server";

/**
 * Live Pollar ramp routes for the Veilpay testnet app (Server API).
 * Empty `routes` means no provider/corridor is enabled in the dashboard yet.
 */
export async function GET(req: Request) {
  const secret = process.env.POLLAR_SECRET_KEY?.trim();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "POLLAR_SECRET_KEY not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("direction") ?? "offramp").toLowerCase();
  const direction = raw === "onramp" ? "ONRAMP" : "OFFRAMP";
  const externalUserId =
    searchParams.get("user")?.trim() || "veilpay-route-probe";

  try {
    const res = await fetch(
      `https://server.api.pollar.xyz/v3/ramps/routes?direction=${direction}`,
      {
        headers: {
          "x-pollar-api-key": secret,
          "x-pollar-external-user-id": externalUserId,
        },
        cache: "no-store",
      },
    );
    const body = (await res.json()) as {
      success?: boolean;
      code?: string;
      content?: { routes?: unknown[] };
      message?: string;
    };

    if (!res.ok || body.success === false) {
      return NextResponse.json(
        {
          ok: false,
          error: body.code ?? body.message ?? `Pollar HTTP ${res.status}`,
          direction,
        },
        { status: 502 },
      );
    }

    const routes = Array.isArray(body.content?.routes) ? body.content!.routes! : [];
    return NextResponse.json({
      ok: true,
      direction: direction.toLowerCase(),
      routeCount: routes.length,
      routes,
      dashboardHint:
        routes.length === 0
          ? "dashboard.pollar.xyz → Ramps → Providers → Pollar Sandbox — enable Buy and/or Sell ARS corridors"
          : null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
