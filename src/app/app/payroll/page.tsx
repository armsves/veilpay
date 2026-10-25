"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CoverageTrafficLight } from "@/components/CoverageTrafficLight";
import { useWallet } from "@/components/WalletProvider";
import { OpenPollarRamp } from "@/components/OpenPollarRamp";
import { loadLocalRoster, saveLocalRoster } from "@/lib/confidential/payroll-local";
import { createSppClient, stroopsToXlm, xlmToStroops, type SppSession } from "@/lib/spp/session";

type Employee = {
  id: string;
  name: string;
  veilName?: string;
  /** Current one-time stealth pay address from VNS */
  stellarAddress: string;
  /** Freighter owner — SPP recipientLookup */
  ownerAddress?: string;
  confidentialBalanceUsdc: string;
  lastSppPayXlm?: string;
};

function sppLookupAddress(e: Employee): string {
  return e.ownerAddress ?? e.stellarAddress;
}

type Solvency = {
  assetsUsdc: string;
  liabilitiesUsdc: string;
  coverage: number;
  panicHalt: boolean;
};

export default function PayrollPage() {
  const wallet = useWallet();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [solvency, setSolvency] = useState<Solvency | null>(null);
  const [veilInput, setVeilInput] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [fundAmount, setFundAmount] = useState("5000");
  const [payAmount, setPayAmount] = useState("1");
  const [selected, setSelected] = useState<string>("");
  const [offrampHint, setOfframpHint] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [spp, setSpp] = useState<SppSession | null>(null);
  const [sppBalance, setSppBalance] = useState<string>("—");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const push = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 14));
  }, []);

  const persistRoster = useCallback((list: Employee[]) => {
    setEmployees(list);
    saveLocalRoster(
      list.map((e) => ({
        id: e.id,
        name: e.name,
        veilName: e.veilName,
        stellarAddress: e.stellarAddress,
        ownerAddress: e.ownerAddress,
        confidentialBalanceUsdc: e.confidentialBalanceUsdc,
        lastSppPayXlm: e.lastSppPayXlm,
      })),
    );
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/payroll");
    const data = await res.json();
    setSolvency(data.solvency);

    const serverEmps = (data.employees ?? []) as Employee[];
    const local = loadLocalRoster();

    // Prefer server if warm; otherwise restore from browser cache.
    if (serverEmps.length > 0) {
      persistRoster(serverEmps);
      if (!selected && serverEmps[0]) setSelected(serverEmps[0].id);
    } else if (local.length > 0) {
      // Re-add each to server so pay APIs work this instance.
      const restored: Employee[] = [];
      for (const e of local) {
        try {
          const r = await fetch("/api/payroll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "add_employee",
              name: e.name,
              veilName: e.veilName,
              // Re-add by .veil so server mints a fresh stealth; pass owner for non-veil rows
              stellarAddress: e.veilName ? undefined : e.stellarAddress,
              ownerAddress: e.ownerAddress,
            }),
          });
          const d = await r.json();
          if (d.ok && d.employee) {
            restored.push({
              id: d.employee.id,
              name: d.employee.name,
              veilName: d.employee.veilName ?? e.veilName,
              stellarAddress: d.employee.stellarAddress,
              ownerAddress: d.employee.ownerAddress ?? e.ownerAddress,
              confidentialBalanceUsdc: "0",
              lastSppPayXlm: e.lastSppPayXlm,
            });
          }
        } catch {
          restored.push({
            ...e,
            confidentialBalanceUsdc: e.confidentialBalanceUsdc ?? "0",
          });
        }
      }
      persistRoster(restored);
      if (!selected && restored[0]) setSelected(restored[0].id);
    } else {
      persistRoster([]);
    }
  }, [persistRoster, selected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setStatus(null);
    const res = await fetch("/api/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (!data.ok) {
      setStatus({ ok: false, text: `${data.code ?? "ERROR"}: ${data.error}` });
      if (data.solvency) setSolvency(data.solvency);
      return data;
    }
    setStatus({ ok: true, text: action.replaceAll("_", " ") });
    if (data.solvency) setSolvency(data.solvency);
    if (data.plan) {
      const fiat = data.plan.pollar?.corridor?.fiat ?? "ARS";
      setOfframpHint(`Unwrapped ${data.plan.unwrapped} → Pollar Sandbox sell ${fiat}`);
    }
    if (action === "add_employee" && data.employee) {
      const emp: Employee = {
        id: data.employee.id,
        name: data.employee.name,
        veilName: data.employee.veilName,
        stellarAddress: data.employee.stellarAddress,
        ownerAddress: data.employee.ownerAddress,
        confidentialBalanceUsdc: data.employee.confidentialBalanceUsdc ?? "0",
      };
      persistRoster([...employees.filter((e) => e.id !== emp.id), emp]);
      setSelected(emp.id);
      setVeilInput("");
      setDisplayName("");
    } else if (action === "fresh_stealth" && data.employee) {
      persistRoster(
        employees.map((e) =>
          e.id === data.employee.id
            ? {
                ...e,
                stellarAddress: data.employee.stellarAddress,
                ownerAddress: data.employee.ownerAddress ?? e.ownerAddress,
              }
            : e,
        ),
      );
    } else if (action === "remove_employee") {
      persistRoster(employees.filter((e) => e.id !== extra.employeeId));
    } else {
      await refresh();
    }
    return data;
  }

  async function addByVeil() {
    const raw = veilInput.trim();
    if (!raw) {
      setStatus({ ok: false, text: "Enter a .veil name (e.g. alice)" });
      return;
    }
    await act("add_employee", {
      veilName: raw,
      name: displayName.trim() || undefined,
    });
  }

  async function connectSpp() {
    if (!wallet.address) {
      setStatus({ ok: false, text: "Connect Freighter on Testnet first" });
      return;
    }
    setBusy(true);
    setStatus(null);
    push("Connecting SPP pool (employer treasury)…");
    try {
      const s = await createSppClient({ userAddress: wallet.address });
      setSpp(s);
      await s.client.sync();
      const b = await s.pool.balance();
      setSppBalance(stroopsToXlm(b));
      push(`SPP shielded balance ${stroopsToXlm(b)} XLM`);
      setStatus({ ok: true, text: "SPP connected" });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function refreshSpp() {
    if (!spp) return;
    setBusy(true);
    try {
      await spp.client.sync();
      const b = await spp.pool.balance();
      setSppBalance(stroopsToXlm(b));
      push(`SPP balance ${stroopsToXlm(b)} XLM`);
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function mintFreshStealth(emp: Employee): Promise<Employee> {
    if (!emp.veilName) return emp;
    const data = await act("fresh_stealth", { employeeId: emp.id });
    if (data?.ok && data.employee) {
      const next: Employee = {
        ...emp,
        stellarAddress: data.employee.stellarAddress,
        ownerAddress: data.employee.ownerAddress ?? emp.ownerAddress,
      };
      persistRoster(employees.map((e) => (e.id === emp.id ? next : e)));
      push(
        `Fresh stealth for ${emp.veilName}.veil → ${next.stellarAddress.slice(0, 6)}…${next.stellarAddress.slice(-4)}`,
      );
      return next;
    }
    return emp;
  }

  async function paySelectedViaSpp() {
    const emp0 = employees.find((e) => e.id === selected);
    if (!emp0 || !spp) {
      setStatus({ ok: false, text: "Select an employee and Connect SPP first" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const emp = await mintFreshStealth(emp0);
      const stroops = xlmToStroops(payAmount);
      const owner = sppLookupAddress(emp);
      push(`Looking up SPP keys for ${emp.veilName ? `${emp.veilName}.veil` : emp.name}…`);
      const lookup = await spp.client.recipientLookup(owner);
      if (!lookup?.entry) {
        throw new Error(
          `${emp.veilName ? `${emp.veilName}.veil` : emp.name} owner must open Private pay → Connect SPP once to register keys`,
        );
      }
      push(
        `Private SPP pay ${payAmount} XLM → ${emp.veilName ? `${emp.veilName}.veil` : emp.name} (stealth ${emp.stellarAddress.slice(0, 6)}…)`,
      );
      // Encrypt to the owner's registered SPP keys (amount hidden); roster shows fresh stealth.
      await spp.pool.transferToKeys(lookup.entry.noteKey, lookup.entry.encryptionKey, stroops);
      await act("mark_spp_paid", { employeeId: emp.id, xlmAmount: payAmount });
      // Also credit confidential demo ledger for solvency story
      await act("pay", { employeeId: emp.id, amount: payAmount });
      await refreshSpp();
      push("SPP private transfer confirmed (amount hidden on-chain)");
      setStatus({ ok: true, text: `Paid ${payAmount} XLM privately to ${emp.name}` });
      persistRoster(
        employees.map((e) =>
          e.id === emp.id ? { ...e, ...emp, lastSppPayXlm: payAmount } : e,
        ),
      );
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function runPayrollAllViaSpp() {
    if (!spp || employees.length === 0) {
      setStatus({ ok: false, text: "Connect SPP and add employees first" });
      return;
    }
    setBusy(true);
    setStatus(null);
    let okCount = 0;
    const next = [...employees];
    try {
      for (const emp0 of employees) {
        push(`Payroll → ${emp0.veilName ? `${emp0.veilName}.veil` : emp0.name}…`);
        const emp = await mintFreshStealth(emp0);
        const lookup = await spp.client.recipientLookup(sppLookupAddress(emp));
        if (!lookup?.entry) {
          push(`Skip ${emp.name}: not SPP-registered`);
          continue;
        }
        const stroops = xlmToStroops(payAmount);
        await spp.pool.transferToKeys(lookup.entry.noteKey, lookup.entry.encryptionKey, stroops);
        await act("mark_spp_paid", { employeeId: emp.id, xlmAmount: payAmount });
        await act("pay", { employeeId: emp.id, amount: payAmount });
        const i = next.findIndex((e) => e.id === emp.id);
        if (i >= 0) next[i] = { ...next[i], ...emp, lastSppPayXlm: payAmount };
        okCount += 1;
        push(`Paid ${payAmount} XLM → ${emp.name}`);
      }
      persistRoster(next);
      await refreshSpp();
      setStatus({
        ok: okCount > 0,
        text: `SPP payroll finished: ${okCount}/${employees.length} paid ${payAmount} XLM each`,
      });
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl tracking-tight">Payroll</h1>
          <p className="mt-0.5 text-sm text-[var(--cream-dim)]">
            Employees by <code className="text-[var(--mint)]">.veil</code> · private SPP payouts
            (amounts hidden) · confidential token · solvency Hooks
          </p>
        </div>
        {status && (
          <p className={`max-w-md text-sm ${status.ok ? "text-[var(--mint)]" : "text-[var(--danger)]"}`}>
            {status.text}
          </p>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Assets B", value: solvency?.assetsUsdc ?? "0" },
          { label: "Liabilities L", value: solvency?.liabilitiesUsdc ?? "0" },
          {
            label: "Halt",
            value: solvency?.panicHalt ? "PANIC" : "OPEN",
            danger: Boolean(solvency?.panicHalt),
          },
          { label: "SPP XLM", value: sppBalance },
        ].map((m) => (
          <div key={m.label} className="panel px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-[var(--cream-dim)]">{m.label}</p>
            <p
              className={`display text-xl leading-tight ${
                "danger" in m && m.danger ? "text-[var(--danger)]" : ""
              }`}
            >
              {m.value}
            </p>
          </div>
        ))}
        <div className="panel flex items-center px-3 py-2.5">
          <CoverageTrafficLight
            compact
            ratio={solvency == null ? null : solvency.coverage}
            panicHalt={solvency?.panicHalt}
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <section className="panel flex min-h-0 flex-col gap-2.5 overflow-hidden p-4">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <h2 className="display text-xl">SPP treasury</h2>
            <div className="flex gap-1.5">
              {!spp ? (
                <button
                  className="btn btn-primary !py-1.5 !px-3 text-xs"
                  disabled={busy || !wallet.address}
                  onClick={() => void connectSpp()}
                >
                  {busy ? "…" : "Connect SPP"}
                </button>
              ) : (
                <button
                  className="btn btn-ghost !py-1.5 !px-3 text-xs"
                  disabled={busy}
                  onClick={() => void refreshSpp()}
                >
                  Refresh
                </button>
              )}
              <Link className="btn btn-ghost !py-1.5 !px-3 text-xs" href="/app/private-pay">
                Deposit XLM
              </Link>
            </div>
          </div>
          <p className="text-xs text-[var(--cream-dim)]">
            Employer shields XLM in the SPP pool, then pays each <code>.veil</code> owner privately
            inside the pool (ext_amount 0). Recipients need Private pay → Connect SPP once.
          </p>
          <div className="flex shrink-0 gap-2">
            <input
              className="input !py-2"
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              aria-label="Fund amount USDC (demo ledger)"
            />
            <button
              className="btn btn-primary shrink-0 !py-2 !px-4 text-sm"
              onClick={() => void act("fund", { amount: fundAmount })}
            >
              Fund ledger
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              className="btn btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => void act("simulate_drain", { deltaUsdc: "250" })}
            >
              Drain
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => void act("halt_if_insolvent")}
            >
              Halt if insolvent
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => void act("panic", { reason: "manual" })}
            >
              Panic
            </button>
            <button
              className="btn btn-amber !py-1.5 !px-2.5 text-xs"
              onClick={() =>
                void act("rescue", { amount: fundAmount }).then((d) => {
                  if (d?.ok) return act("unpause");
                })
              }
            >
              Rescue + unpause
            </button>
          </div>
          {offrampHint && (
            <p className="shrink-0 rounded-lg bg-black/25 px-3 py-2 text-xs text-[var(--mint)]">
              {offrampHint}
            </p>
          )}
          <ul className="mt-auto max-h-28 space-y-1 overflow-y-auto font-mono text-[10px] text-[var(--cream-dim)]">
            {log.length === 0 && <li>SPP activity will show here</li>}
            {log.map((l, i) => (
              <li key={`${i}-${l.slice(0, 10)}`}>{l}</li>
            ))}
          </ul>
        </section>

        <section className="panel flex min-h-0 flex-col gap-2.5 overflow-hidden p-4">
          <h2 className="display shrink-0 text-xl">Employees</h2>
          <div className="grid shrink-0 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <div className="relative">
              <input
                className="input !py-2 !pr-12"
                placeholder="alice"
                value={veilInput}
                onChange={(e) => setVeilInput(e.target.value.toLowerCase())}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--mint)]">
                .veil
              </span>
            </div>
            <input
              className="input !py-2"
              placeholder="Label (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <button
              className="btn btn-primary !py-2 !px-3 text-xs"
              disabled={busy}
              onClick={() => void addByVeil()}
            >
              Add
            </button>
          </div>
          <p className="text-[10px] text-[var(--cream-dim)]">
            Each add/pay mints a <strong className="font-medium text-[var(--cream)]">fresh stealth G…</strong>{" "}
            via VNS (never the Freighter owner). SPP still delivers to the owner&apos;s registered pool
            keys.{" "}
            <Link className="text-[var(--mint)] underline" href="/app/stealth">
              Register names
            </Link>{" "}
            first.
          </p>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {employees.length === 0 && (
              <li className="text-sm text-[var(--cream-dim)]">
                No employees — add <code>alice.veil</code>, <code>bob.veil</code>, …
              </li>
            )}
            {employees.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={`flex w-full items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm ${
                    selected === e.id
                      ? "border-[var(--mint)] bg-[var(--mint-dim)]"
                      : "border-[var(--line)]"
                  }`}
                  onClick={() => setSelected(e.id)}
                >
                  <span className="min-w-0">
                    <span className="font-medium">{e.name}</span>
                    {e.veilName && (
                      <span className="ml-1.5 text-[var(--mint)]">{e.veilName}.veil</span>
                    )}
                    <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--cream-dim)]">
                      stealth {e.stellarAddress.slice(0, 6)}…{e.stellarAddress.slice(-4)}
                    </span>
                    {e.ownerAddress && (
                      <span className="block truncate font-mono text-[9px] text-[var(--cream-dim)]/70">
                        owner {e.ownerAddress.slice(0, 6)}…{e.ownerAddress.slice(-4)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs text-[var(--cream-dim)]">
                    <span className="block">{e.confidentialBalanceUsdc} conf.</span>
                    {e.lastSppPayXlm && (
                      <span className="text-[var(--mint)]">last {e.lastSppPayXlm} XLM</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2.5">
            <input
              className="input max-w-[88px] !py-2"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              aria-label="Pay amount XLM"
              title="XLM per SPP private transfer"
            />
            <button
              className="btn btn-primary !py-1.5 !px-3 text-xs"
              disabled={!selected || !spp || busy}
              onClick={() => void paySelectedViaSpp()}
            >
              SPP pay
            </button>
            <button
              className="btn btn-amber !py-1.5 !px-3 text-xs"
              disabled={!spp || employees.length === 0 || busy}
              onClick={() => void runPayrollAllViaSpp()}
            >
              Run all
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-3 text-xs"
              disabled={!selected || busy}
              onClick={() => void act("remove_employee", { employeeId: selected })}
            >
              Remove
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-3 text-xs"
              disabled={!selected}
              onClick={() => void act("offramp", { employeeId: selected, amount: payAmount, fiat: "ARS" })}
            >
              Unwrap → ARS
            </button>
            <OpenPollarRamp label="Pollar" className="btn btn-ghost !py-1.5 !px-3 text-xs" />
          </div>
        </section>
      </div>
    </div>
  );
}
