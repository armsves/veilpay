import { NextResponse } from "next/server";
import {
  getVeilNameRegistry,
  normalizeName,
  toFqdn,
  validateName,
} from "@/lib/stealth/nameservice";
import { fetchXlmBalance } from "@/lib/stellar/rpc";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  const owner = searchParams.get("owner");
  const action = searchParams.get("action") ?? "lookup";
  const registry = getVeilNameRegistry();

  if (action === "list") {
    return NextResponse.json({
      ok: true,
      names: registry.list().map((r) => publicRecord(r, false)),
    });
  }

  if (action === "available" && name) {
    const v = validateName(name);
    if (!v.ok) return NextResponse.json({ ok: true, available: false, error: v.error });
    return NextResponse.json({
      ok: true,
      available: registry.available(v.name),
      fqdn: toFqdn(v.name),
    });
  }

  if (action === "inbox" && owner) {
    const record = registry.getByOwner(owner);
    const { candidates } = registry.listSweepCandidates(owner, 48);

    // Always re-derive recent indices so a wiped serverless inbox still shows funded burners.
    const scanned = await Promise.all(
      candidates.map(async (c) => {
        const balanceXlm = await fetchXlmBalance(c.address);
        const known = record?.inbox.find((a) => a.index === c.index || a.stealthAddress === c.address);
        return {
          id: known?.id ?? `idx_${c.index}`,
          index: c.index,
          stealthAddress: c.address,
          memoHint: known?.memoHint ?? `vp-i${c.index}`,
          viewTag: known?.viewTag ?? 0,
          createdAt: known?.createdAt ?? 0,
          swept: known?.swept ?? false,
          balanceXlm,
        };
      }),
    );

    const fundedOrKnown = scanned.filter(
      (a) => a.balanceXlm > 0 || (record?.inbox.some((i) => i.index === a.index) ?? false),
    );

    return NextResponse.json({
      ok: true,
      record: record ? publicRecord(record, true) : null,
      inbox: fundedOrKnown.length > 0 ? fundedOrKnown : scanned.slice(0, 5),
      howToSweep:
        "Addresses are derived from your wallet + payment index. Scan & sweep recomputes keys even after deploys wipe server memory.",
    });
  }

  if (owner) {
    const record = registry.getByOwner(owner);
    return NextResponse.json({
      ok: true,
      record: record ? publicRecord(record, true) : null,
    });
  }

  if (name) {
    const record = registry.get(name);
    if (!record) {
      return NextResponse.json(
        { ok: false, error: `${toFqdn(normalizeName(name))} is not registered` },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, record: publicRecord(record, false) });
  }

  return NextResponse.json({
    ok: true,
    tld: "veil",
    hint: "Register alice.veil → resolve fresh stealth addresses → owner sweeps inbox to Freighter",
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action: string;
    name?: string;
    owner?: string;
    announcementId?: string;
    index?: number;
    submit?: boolean;
  };
  const registry = getVeilNameRegistry();

  try {
    switch (body.action) {
      case "register": {
        if (!body.name || !body.owner) {
          return NextResponse.json({ ok: false, error: "name and owner required" }, { status: 400 });
        }
        const record = registry.register({ name: body.name, owner: body.owner });
        return NextResponse.json({ ok: true, record: publicRecord(record, true) });
      }
      case "resolve": {
        if (!body.name) {
          return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
        }
        const { record, payment, announcement } = registry.resolve(body.name);
        return NextResponse.json({
          ok: true,
          fqdn: record.fqdn,
          resolveCount: record.resolveCount,
          announcementId: announcement.id,
          index: payment.index,
          stealthAddress: payment.stealthAddress,
          ephemeralPubKey: payment.ephemeralPubKey,
          viewTag: payment.viewTag,
          memoHint: payment.memoHint,
        });
      }
      case "sweep": {
        // Prepare only — client shields via SPP (deposit + private transfer).
        // Never public-pay stealth → Freighter (that links the receive).
        if (!body.owner || (!body.announcementId && body.index == null)) {
          return NextResponse.json(
            { ok: false, error: "owner and announcementId (or index) required" },
            { status: 400 },
          );
        }

        let stealthSecret: string;
        let stealthAddress: string;
        let index = body.index;

        if (body.announcementId) {
          const prepared = registry.prepareSweep({
            owner: body.owner,
            announcementId: body.announcementId,
          });
          stealthSecret = prepared.stealthSecret;
          stealthAddress = prepared.stealthAddress;
          index = prepared.index;
        } else {
          const { candidates } = registry.listSweepCandidates(body.owner, index ?? 64);
          const hit = candidates.find((c) => c.index === index);
          if (!hit) throw new Error("Index out of range");
          stealthSecret = hit.secret;
          stealthAddress = hit.address;
        }

        const balanceXlm = await fetchXlmBalance(stealthAddress);
        return NextResponse.json({
          ok: true,
          prepared: true,
          stealthAddress,
          stealthSecret,
          balanceXlm,
          index,
          destination: body.owner,
          note: "Client must SPP-deposit from stealth then private-transfer to owner — do not public-pay Freighter.",
        });
      }
      case "scanSweep": {
        if (!body.owner) {
          return NextResponse.json({ ok: false, error: "owner required" }, { status: 400 });
        }
        const { candidates } = registry.listSweepCandidates(body.owner, 64);
        const ready: Array<{
          index: number;
          address: string;
          secret: string;
          balanceXlm: number;
        }> = [];

        for (const c of candidates) {
          const balanceXlm = await fetchXlmBalance(c.address);
          // Base reserve (~1 XLM) + small fee pad + min deposit.
          if (balanceXlm >= 1.25) {
            ready.push({
              index: c.index,
              address: c.address,
              secret: c.secret,
              balanceXlm,
            });
          }
        }

        return NextResponse.json({
          ok: true,
          ready,
          note:
            ready.length === 0
              ? "No stealth addresses with ≳1.25 XLM to SPP-shield."
              : `Prepared ${ready.length} address(es) for SPP shield — client deposits then private-transfers.`,
        });
      }
      case "markSwept": {
        if (!body.owner || body.index == null) {
          return NextResponse.json({ ok: false, error: "owner and index required" }, { status: 400 });
        }
        registry.markIndexSwept(body.owner, body.index);
        if (body.announcementId) registry.markSwept(body.owner, body.announcementId);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 409 });
  }
}

function publicRecord(
  r: NonNullable<ReturnType<ReturnType<typeof getVeilNameRegistry>["get"]>>,
  includeInboxMeta: boolean,
) {
  return {
    name: r.name,
    fqdn: r.fqdn,
    owner: r.owner,
    createdAt: r.createdAt,
    resolveCount: r.resolveCount,
    metaEncoded: r.meta.encoded,
    payUrl: `/pay/${r.name}`,
    inboxCount: r.inbox.length,
    ...(includeInboxMeta
      ? {
          inbox: r.inbox.map((a) => ({
            id: a.id,
            index: a.index,
            stealthAddress: a.stealthAddress,
            memoHint: a.memoHint,
            createdAt: a.createdAt,
            swept: a.swept,
          })),
        }
      : {}),
  };
}
