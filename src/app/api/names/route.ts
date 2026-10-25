import { NextResponse } from "next/server";
import {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  getVeilNameRegistry,
  normalizeName,
  toFqdn,
  validateName,
} from "@/lib/stealth/nameservice";
import { currentNetwork } from "@/lib/stellar/config";
import { createRpcServer, fetchXlmBalance, submitAndConfirm } from "@/lib/stellar/rpc";

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
    if (!record) return NextResponse.json({ ok: true, record: null, inbox: [] });
    const inbox = await Promise.all(
      record.inbox.map(async (a) => ({
        id: a.id,
        stealthAddress: a.stealthAddress,
        memoHint: a.memoHint,
        viewTag: a.viewTag,
        createdAt: a.createdAt,
        swept: a.swept,
        balanceXlm: await fetchXlmBalance(a.stealthAddress),
      })),
    );
    return NextResponse.json({
      ok: true,
      record: publicRecord(record, true),
      inbox,
      howToSweep:
        "Each pay-page resolve creates a one-time address. Only you (name owner) can recompute its secret from the viewing key and move XLM to Freighter.",
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
          stealthAddress: payment.stealthAddress,
          ephemeralPubKey: payment.ephemeralPubKey,
          viewTag: payment.viewTag,
          memoHint: payment.memoHint,
        });
      }
      case "sweep": {
        if (!body.owner || !body.announcementId) {
          return NextResponse.json(
            { ok: false, error: "owner and announcementId required" },
            { status: 400 },
          );
        }
        const prepared = registry.prepareSweep({
          owner: body.owner,
          announcementId: body.announcementId,
        });

        const balance = await fetchXlmBalance(prepared.stealthAddress);
        if (balance <= 1.00001) {
          return NextResponse.json({
            ok: true,
            needsFunding: true,
            stealthAddress: prepared.stealthAddress,
            balanceXlm: balance,
            stealthSecret: prepared.stealthSecret,
            destination: prepared.destination,
            note: "No spendable XLM yet (account missing or only base reserve). After someone pays this address, Sweep again — or import stealthSecret in Lab to move funds manually.",
          });
        }

        const net = currentNetwork();
        const server = createRpcServer();
        const source = await server.getAccount(prepared.stealthAddress);
        // Leave ~1.5 XLM for base reserve + fee headroom on the burner; send rest to Freighter.
        const keep = 1.5;
        const sendAmount = Math.max(0, Math.floor((balance - keep) * 1e7) / 1e7);
        if (sendAmount <= 0) {
          return NextResponse.json({
            ok: false,
            error: `Balance ${balance} XLM too low to sweep after reserves`,
            stealthSecret: prepared.stealthSecret,
          });
        }

        const kp = Keypair.fromSecret(prepared.stealthSecret);
        const tx = new TransactionBuilder(source, {
          fee: BASE_FEE,
          networkPassphrase: net.networkPassphrase,
        })
          .addOperation(
            Operation.payment({
              destination: prepared.destination,
              asset: Asset.native(),
              amount: sendAmount.toFixed(7),
            }),
          )
          .setTimeout(180)
          .build();
        tx.sign(kp);

        if (body.submit) {
          const { hash } = await submitAndConfirm(tx);
          registry.markSwept(body.owner, body.announcementId);
          return NextResponse.json({
            ok: true,
            submitted: true,
            amountXlm: sendAmount,
            from: prepared.stealthAddress,
            to: prepared.destination,
            hash,
          });
        }

        return NextResponse.json({
          ok: true,
          submitted: false,
          amountXlm: sendAmount,
          from: prepared.stealthAddress,
          to: prepared.destination,
          xdr: tx.toXDR(),
          stealthSecret: prepared.stealthSecret,
          note: "Pass submit:true to broadcast, or sign/submit the XDR yourself.",
        });
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
            stealthAddress: a.stealthAddress,
            memoHint: a.memoHint,
            createdAt: a.createdAt,
            swept: a.swept,
          })),
        }
      : {}),
  };
}

