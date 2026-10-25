"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { OpenPollarRamp } from "@/components/OpenPollarRamp";

type Employee = {
  id: string;
  name: string;
  stellarAddress: string;
  confidentialBalanceUsdc: string;
};

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
  const [name, setName] = useState("Ada Lovelace");
  const [address, setAddress] = useState("");
  const [fundAmount, setFundAmount] = useState("5000");
  const [payAmount, setPayAmount] = useState("250");
  const [selected, setSelected] = useState<string>("");
  const [offrampHint, setOfframpHint] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (wallet.address && !address) setAddress(wallet.address);
  }, [wallet.address, address]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/payroll");
    const data = await res.json();
    setEmployees(data.employees);
    setSolvency(data.solvency);
    if (!selected && data.employees[0]) setSelected(data.employees[0].id);
  }, [selected]);

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
    await refresh();
    return data;
  }

  const coverage =
    solvency == null
      ? "—"
      : !Number.isFinite(solvency.coverage)
        ? "∞"
        : `${(solvency.coverage * 100).toFixed(1)}%`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl tracking-tight">Payroll</h1>
          <p className="mt-0.5 text-sm text-[var(--cream-dim)]">
            Solvency-gated confidential pool · Pollar Sandbox offramp
          </p>
        </div>
        {status && (
          <p className={`text-sm ${status.ok ? "text-[var(--mint)]" : "text-[var(--danger)]"}`}>
            {status.text}
          </p>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Assets B", value: solvency?.assetsUsdc ?? "0" },
          { label: "Liabilities L", value: solvency?.liabilitiesUsdc ?? "0" },
          { label: "Coverage", value: coverage },
          {
            label: "Halt",
            value: solvency?.panicHalt ? "PANIC" : "OPEN",
            danger: Boolean(solvency?.panicHalt),
          },
        ].map((m) => (
          <div key={m.label} className="panel px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider text-[var(--cream-dim)]">{m.label}</p>
            <p
              className={`display text-xl leading-tight ${
                m.danger ? "text-[var(--danger)]" : ""
              }`}
            >
              {m.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        <section className="panel flex min-h-0 flex-col gap-2.5 overflow-hidden p-4">
          <h2 className="display shrink-0 text-xl">Treasury</h2>
          <div className="flex shrink-0 gap-2">
            <input
              className="input !py-2"
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              aria-label="Fund amount USDC"
            />
            <button
              className="btn btn-primary shrink-0 !py-2 !px-4 text-sm"
              onClick={() => act("fund", { amount: fundAmount })}
            >
              Deposit
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              className="btn btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => act("simulate_drain", { deltaUsdc: "250" })}
            >
              Drain
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => act("halt_if_insolvent")}
            >
              Halt if insolvent
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => act("panic", { reason: "manual" })}
            >
              Panic
            </button>
            <button
              className="btn btn-amber !py-1.5 !px-2.5 text-xs"
              onClick={() =>
                act("rescue", { amount: fundAmount }).then((d) => {
                  if (d?.ok) return act("unpause");
                })
              }
            >
              Rescue + unpause
            </button>
          </div>
          {offrampHint && (
            <p className="mt-auto shrink-0 rounded-lg bg-black/25 px-3 py-2 text-xs text-[var(--mint)]">
              {offrampHint}
            </p>
          )}
        </section>

        <section className="panel flex min-h-0 flex-col gap-2.5 overflow-hidden p-4">
          <h2 className="display shrink-0 text-xl">Employees</h2>
          <div className="grid shrink-0 gap-2 sm:grid-cols-2">
            <input
              className="input !py-2"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="input !py-2 font-mono text-xs"
              placeholder="G…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button
              className="btn btn-ghost !py-1.5 !px-2.5 text-xs"
              onClick={() => act("add_employee", { name, stellarAddress: address })}
            >
              Add
            </button>
            {wallet.address && (
              <button
                type="button"
                className="btn btn-ghost !py-1.5 !px-2.5 text-xs"
                onClick={() => setAddress(wallet.address!)}
              >
                Use wallet
              </button>
            )}
          </div>
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {employees.length === 0 && (
              <li className="text-sm text-[var(--cream-dim)]">No employees yet</li>
            )}
            {employees.map((e) => (
              <li key={e.id}>
                <button
                  className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-sm ${
                    selected === e.id
                      ? "border-[var(--mint)] bg-[var(--mint-dim)]"
                      : "border-[var(--line)]"
                  }`}
                  onClick={() => setSelected(e.id)}
                >
                  <span className="font-medium">{e.name}</span>
                  <span className="ml-2 text-[var(--cream-dim)]">{e.confidentialBalanceUsdc}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2.5">
            <input
              className="input max-w-[100px] !py-2"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              aria-label="Pay amount"
            />
            <button
              className="btn btn-primary !py-1.5 !px-3 text-xs"
              disabled={!selected}
              onClick={() => act("pay", { employeeId: selected, amount: payAmount })}
            >
              Pay
            </button>
            <button
              className="btn btn-amber !py-1.5 !px-3 text-xs"
              disabled={!selected}
              onClick={() => act("offramp", { employeeId: selected, amount: payAmount, fiat: "ARS" })}
            >
              Unwrap → ARS
            </button>
            <OpenPollarRamp label="Pollar ramp" className="btn btn-ghost !py-1.5 !px-3 text-xs" />
          </div>
        </section>
      </div>
    </div>
  );
}
