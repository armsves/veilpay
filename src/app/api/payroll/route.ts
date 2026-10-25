import { NextResponse } from "next/server";
import { getPayrollService } from "@/lib/confidential/payroll";
import { formatUsdc } from "@/lib/confidential/solvency";
import { getVeilNameRegistry, normalizeName, toFqdn } from "@/lib/stealth/nameservice";

export async function GET() {
  const svc = getPayrollService();
  const snap = svc.coverage();
  return NextResponse.json({
    solvency: {
      ...snap,
      assets: snap.assets.toString(),
      liabilities: snap.liabilities.toString(),
      assetsUsdc: formatUsdc(snap.assets),
      liabilitiesUsdc: formatUsdc(snap.liabilities),
    },
    employees: svc.employees.map((e) => ({
      ...e,
      confidentialBalance: e.confidentialBalance.toString(),
      confidentialBalanceUsdc: formatUsdc(e.confidentialBalance),
    })),
    runs: svc.runs.slice(0, 10),
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    action: string;
    amount?: string;
    name?: string;
    veilName?: string;
    stellarAddress?: string;
    stealthMeta?: string;
    employeeId?: string;
    fiat?: "ARS" | "PEN";
    payments?: Array<{ employeeId: string; amount: string }>;
    reason?: string;
    deltaUsdc?: string;
    xlmAmount?: string;
  };

  const svc = getPayrollService();

  try {
    switch (body.action) {
      case "fund": {
        const snap = svc.fundTreasury(body.amount ?? "1000");
        return NextResponse.json({ ok: true, solvency: serializeSnap(snap) });
      }
      case "add_employee": {
        let stellarAddress = body.stellarAddress?.trim() ?? "";
        let veilName = body.veilName?.trim() || undefined;
        let displayName = body.name?.trim() || undefined;

        if (veilName || (displayName && !stellarAddress.startsWith("G"))) {
          const raw = veilName || displayName || "";
          const name = normalizeName(raw);
          const record = getVeilNameRegistry().get(name);
          if (!record) {
            return NextResponse.json(
              {
                ok: false,
                error: `${toFqdn(name)} is not registered — employee must claim it under Stealth names first`,
              },
              { status: 404 },
            );
          }
          veilName = record.name;
          stellarAddress = record.owner;
          displayName = displayName || record.fqdn;
        }

        if (!stellarAddress.startsWith("G") || stellarAddress.length < 56) {
          return NextResponse.json(
            { ok: false, error: "Need a registered .veil name or a Stellar G… address" },
            { status: 400 },
          );
        }

        const emp = svc.addEmployee({
          name: displayName || veilName || "Employee",
          veilName,
          stellarAddress,
          stealthMeta: body.stealthMeta,
        });
        return NextResponse.json({
          ok: true,
          employee: {
            ...emp,
            confidentialBalance: emp.confidentialBalance.toString(),
            confidentialBalanceUsdc: formatUsdc(emp.confidentialBalance),
          },
        });
      }
      case "remove_employee": {
        if (!body.employeeId) {
          return NextResponse.json({ ok: false, error: "employeeId required" }, { status: 400 });
        }
        svc.removeEmployee(body.employeeId);
        return NextResponse.json({ ok: true });
      }
      case "mark_spp_paid": {
        if (!body.employeeId || !body.xlmAmount) {
          return NextResponse.json(
            { ok: false, error: "employeeId and xlmAmount required" },
            { status: 400 },
          );
        }
        const emp = svc.markSppPaid(body.employeeId, body.xlmAmount);
        return NextResponse.json({ ok: true, employee: emp });
      }
      case "pay": {
        if (!body.employeeId || !body.amount) {
          return NextResponse.json({ ok: false, error: "employeeId and amount required" }, { status: 400 });
        }
        const result = svc.payEmployee(body.employeeId, body.amount);
        return NextResponse.json({ ok: true, result, solvency: serializeSnap(svc.coverage()) });
      }
      case "run_payroll": {
        const run = svc.runPayroll(body.payments ?? []);
        return NextResponse.json({ ok: true, run, solvency: serializeSnap(svc.coverage()) });
      }
      case "offramp": {
        if (!body.employeeId || !body.amount || !body.fiat) {
          return NextResponse.json({ ok: false, error: "employeeId, amount, fiat required" }, { status: 400 });
        }
        const plan = svc.prepareOfframp(body.employeeId, body.amount, body.fiat);
        return NextResponse.json({
          ok: true,
          plan: {
            ...plan,
            employee: {
              ...plan.employee,
              confidentialBalance: plan.employee.confidentialBalance.toString(),
            },
            solvency: serializeSnap(plan.solvency),
          },
        });
      }
      case "simulate_drain": {
        const { parseUsdc } = await import("@/lib/confidential/solvency");
        const delta = -(parseUsdc(body.deltaUsdc ?? "100"));
        const snap = svc.solvency.applyExternalAssetDelta(delta);
        return NextResponse.json({ ok: true, solvency: serializeSnap(snap) });
      }
      case "panic": {
        const snap = svc.solvency.forcePanic(body.reason ?? "operator panic");
        return NextResponse.json({ ok: true, solvency: serializeSnap(snap) });
      }
      case "halt_if_insolvent": {
        const snap = svc.solvency.haltIfInsolvent(body.reason ?? "monitor");
        return NextResponse.json({ ok: true, solvency: serializeSnap(snap) });
      }
      case "rescue": {
        const { parseUsdc } = await import("@/lib/confidential/solvency");
        const snap = svc.solvency.rescueDeposit(parseUsdc(body.amount ?? "250"));
        return NextResponse.json({ ok: true, solvency: serializeSnap(snap) });
      }
      case "unpause": {
        const snap = svc.solvency.unpause(body.reason ?? "governance rescue");
        return NextResponse.json({ ok: true, solvency: serializeSnap(snap) });
      }
      default:
        return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : undefined;
    return NextResponse.json({ ok: false, error: message, code, solvency: serializeSnap(svc.coverage()) }, { status: 409 });
  }
}

function serializeSnap(snap: ReturnType<ConfidentialPayrollService["coverage"]>) {
  return {
    ...snap,
    assets: snap.assets.toString(),
    liabilities: snap.liabilities.toString(),
    assetsUsdc: formatUsdc(snap.assets),
    liabilitiesUsdc: formatUsdc(snap.liabilities),
  };
}

type ConfidentialPayrollService = ReturnType<typeof getPayrollService>;
