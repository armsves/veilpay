"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { BusyLabel } from "@/components/Spinner";
import { CoverageTrafficLight } from "@/components/CoverageTrafficLight";
import { useWallet } from "@/components/WalletProvider";
import { CONFIDENTIAL_TOKEN_ID } from "@/lib/confidential/config";
import { isCrossOriginIsolated } from "@/lib/confidential/bb-loader";
import {
  checkRegistered,
  clearConfidentialSession,
  confidentialTransfer,
  depositNative,
  formatXlm,
  isRegistered,
  localBalances,
  mergeReceiving,
  mergeReceivingIfNeeded,
  openConfidentialSession,
  parseXlm,
  readSolvency,
  registerAccount,
  withdrawNative,
  type ConfidentialSession,
} from "@/lib/confidential/session";

type LogLine = { t: number; text: string; ok?: boolean };
type BusyAction =
  | "unlock"
  | "register"
  | "deposit"
  | "merge"
  | "transfer"
  | "withdraw"
  | "refresh"
  | null;

export default function ConfidentialPage() {
  const { address } = useWallet();
  const [session, setSession] = useState<ConfidentialSession | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [amountXlm, setAmountXlm] = useState("1");
  const [withdrawXlm, setWithdrawXlm] = useState("1");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [transferXlm, setTransferXlm] = useState("1");
  const [transferTo, setTransferTo] = useState("");
  const [solvency, setSolvency] = useState<{
    assets: string;
    liabilities: string;
    coverage_bps: number;
    panic_halt: boolean;
  } | null>(null);
  const [balances, setBalances] = useState<{ spendable: string; receiving: string } | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);

  const busy = busyAction !== null;

  const push = useCallback((text: string, ok?: boolean) => {
    setLog((prev) => [{ t: Date.now(), text, ok }, ...prev].slice(0, 40));
    if (ok === true) toast.success(text);
    else if (ok === false) toast.error(text);
    else toast.info(text);
  }, []);

  const loadPublicStatus = useCallback(async (addr: string | null) => {
    try {
      const v = await readSolvency();
      setSolvency({
        assets: formatXlm(v.assets.toString()),
        liabilities: formatXlm(v.liabilities.toString()),
        coverage_bps: v.coverage_bps,
        panic_halt: v.panic_halt,
      });
    } catch {
      setSolvency(null);
    }
    if (!addr) {
      setRegistered(null);
      return;
    }
    try {
      setRegistered(await checkRegistered(addr));
    } catch {
      setRegistered(false);
    }
  }, []);

  useEffect(() => {
    setIsolated(isCrossOriginIsolated());
  }, []);

  const prevAddress = useRef<string | null | undefined>(undefined);
  const unlockInFlight = useRef(false);
  /** Address we last successfully unlocked for (skip repeat auto-unlock). */
  const unlockedFor = useRef<string | null>(null);

  useEffect(() => {
    const switched =
      prevAddress.current !== undefined && prevAddress.current !== address;
    prevAddress.current = address;

    clearConfidentialSession();
    setSession(null);
    setBalances(null);
    setLog([]);
    unlockedFor.current = null;
    void loadPublicStatus(address);

    if (switched && address) {
      toast.info(
        `Switched to ${address.slice(0, 6)}…${address.slice(-4)} — unlocking balances…`,
      );
    }
  }, [address, loadPublicStatus]);

  const refreshSessionViews = useCallback(
    async (s: ConfidentialSession) => {
      setRegistered(await isRegistered(s));
      await loadPublicStatus(s.address);
      const bal = await localBalances(s);
      setBalances({
        spendable: formatXlm(bal?.spendable ?? 0n),
        receiving: formatXlm(bal?.receiving ?? 0n),
      });
    },
    [loadPublicStatus],
  );

  const ensureSession = useCallback(async (): Promise<ConfidentialSession> => {
    if (!address) throw new Error("Connect Freighter on Testnet first");
    if (session && session.address === address) return session;
    push("Approve Freighter message (privacy key root)…");
    const s = await openConfidentialSession(address);
    setSession(s);
    await refreshSessionViews(s);
    push("Confidential keys ready", true);
    return s;
  }, [address, session, push, refreshSessionViews]);

  /** Sync openings; if receiving > 0, merge into spendable (Freighter sign). */
  const syncAndAutoMerge = useCallback(
    async (s: ConfidentialSession) => {
      await refreshSessionViews(s);
      const merged = await mergeReceivingIfNeeded(s);
      if (merged) {
        push(
          `Auto-merged ${formatXlm(merged.amount)} XLM receiving → spendable — ${merged.hash.slice(0, 12)}…`,
          true,
        );
        await refreshSessionViews(s);
      }
    },
    [push, refreshSessionViews],
  );

  const unlockBalances = useCallback(async () => {
    if (!address) throw new Error("Connect Freighter on Testnet first");
    const s = await ensureSession();
    await syncAndAutoMerge(s);
    unlockedFor.current = address;
    push("Balances loaded from openings", true);
  }, [address, ensureSession, syncAndAutoMerge, push]);

  // Auto-unlock when Freighter is ready, COI is on, and account is registered.
  useEffect(() => {
    if (!address || !isolated || registered !== true) return;
    if (unlockedFor.current === address || unlockInFlight.current) return;

    unlockInFlight.current = true;
    setBusyAction("unlock");
    void unlockBalances()
      .catch((e) => {
        push(e instanceof Error ? e.message : String(e), false);
      })
      .finally(() => {
        unlockInFlight.current = false;
        setBusyAction(null);
      });
  }, [address, isolated, registered, unlockBalances, push]);

  async function runAction(action: Exclude<BusyAction, null>, fn: () => Promise<void>) {
    setBusyAction(action);
    try {
      await fn();
    } catch (e) {
      push(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusyAction(null);
    }
  }

  async function onUnlockBalances() {
    await runAction("unlock", () => unlockBalances());
  }

  async function onRegister() {
    await runAction("register", async () => {
      const s = await ensureSession();
      if (await isRegistered(s)) {
        push("Already registered on-chain", true);
        await refreshSessionViews(s);
        return;
      }
      push("Proving register (~1s)…");
      const hash = await registerAccount(s);
      push(`Registered — ${hash.slice(0, 12)}…`, true);
      await refreshSessionViews(s);
    });
  }

  async function onDeposit() {
    await runAction("deposit", async () => {
      const s = await ensureSession();
      if (!(await isRegistered(s))) {
        throw new Error("Register first (#3501 AccountNotRegistered)");
      }
      const stroops = parseXlm(amountXlm);
      if (stroops <= 0n) throw new Error("Enter a positive XLM amount");
      push(`Depositing ${amountXlm} XLM (public → confidential receiving)…`);
      const hash = await depositNative(s, stroops);
      push(`Deposit ok — ${hash.slice(0, 12)}…`, true);
      push("Merging receiving → spendable…");
      const mh = await mergeReceiving(s);
      push(`Merged — ${mh.slice(0, 12)}…`, true);
      await refreshSessionViews(s);
    });
  }

  async function onMerge() {
    await runAction("merge", async () => {
      const s = await ensureSession();
      push("Merging receiving → spendable…");
      const hash = await mergeReceiving(s);
      push(`Merged — ${hash.slice(0, 12)}…`, true);
      await refreshSessionViews(s);
    });
  }

  async function onWithdraw() {
    await runAction("withdraw", async () => {
      const s = await ensureSession();
      if (!(await isRegistered(s))) throw new Error("Register first");
      const stroops = parseXlm(withdrawXlm);
      if (stroops <= 0n) throw new Error("Enter a positive withdraw amount");
      push(`Proving withdraw (~2s) of ${withdrawXlm} XLM…`);
      const hash = await withdrawNative(s, stroops, withdrawTo || undefined);
      push(`Withdrawn — ${hash.slice(0, 12)}…`, true);
      await refreshSessionViews(s);
    });
  }

  async function onTransfer() {
    await runAction("transfer", async () => {
      const s = await ensureSession();
      if (!(await isRegistered(s))) throw new Error("Register first");
      const stroops = parseXlm(transferXlm);
      if (stroops <= 0n) throw new Error("Enter a positive transfer amount");
      if (!transferTo.trim()) throw new Error("Enter recipient G… address");
      push(`Proving confidential transfer (~2s) of ${transferXlm} XLM → ${transferTo.slice(0, 6)}…`);
      const hash = await confidentialTransfer(s, transferTo, stroops);
      push(`Transferred — ${hash.slice(0, 12)}… (recipient must Merge)`, true);
      await refreshSessionViews(s);
    });
  }

  async function onRefresh() {
    await runAction("refresh", async () => {
      await loadPublicStatus(address);
      if (session) {
        await syncAndAutoMerge(session);
        push("Status refreshed", true);
      } else if (address) {
        push("Unlock balances first to sync openings", false);
      } else {
        push("Status refreshed", true);
      }
    });
  }

  const unlocked = session !== null;
  const opsReady = unlocked && registered === true && !busy;
  const spendableLabel = balances?.spendable ?? "—";
  const receivingLabel = balances?.receiving ?? "—";

  return (
    <div className="space-y-8">
      <div>
        <p className="pill mb-3">OZ confidential token</p>
        <h1 className="display text-4xl tracking-tight sm:text-5xl">Confidential ops</h1>
        <p className="mt-3 max-w-2xl text-[var(--cream-dim)]">
          Register, deposit,{" "}
          <code className="text-[var(--mint)]">confidential_transfer</code>, and{" "}
          <code className="text-[var(--mint)]">withdraw</code> on{" "}
          <a
            className="underline"
            href={`https://stellar.expert/explorer/testnet/contract/${CONFIDENTIAL_TOKEN_ID}`}
            target="_blank"
            rel="noreferrer"
          >
            {CONFIDENTIAL_TOKEN_ID.slice(0, 8)}…{CONFIDENTIAL_TOKEN_ID.slice(-4)}
          </a>
          . Solvency Hooks gate deposit/withdraw.
        </p>
      </div>

      {!isolated && (
        <div className="panel border-[var(--amber)] p-4 text-sm text-[var(--amber)]">
          SharedArrayBuffer unavailable — hard-refresh this page so COOP/COEP apply. Proving will
          fail until <code>crossOriginIsolated</code> is true.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {!address ? (
            <p className="text-[var(--amber)]">Connect Freighter on Testnet in the header.</p>
          ) : (
            <div className="panel space-y-4 p-5">
              <p className="text-sm text-[var(--cream-dim)]">
                Account{" "}
                <span className="font-mono text-[var(--cream)]">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
              </p>
              <p className="text-sm">
                Registered:{" "}
                {registered == null ? (
                  "…"
                ) : registered ? (
                  <span className="pill pill-ok">yes</span>
                ) : (
                  <span className="pill">no</span>
                )}
                {isolated ? (
                  <span className="ml-2 pill pill-ok">COI</span>
                ) : (
                  <span className="ml-2 pill pill-danger">no COI</span>
                )}
              </p>

              {registered ? (
                <div className="relative rounded-lg border border-[var(--line)] bg-[var(--forest-deep)]/40 p-4 pt-9">
                  <button
                    type="button"
                    className="btn btn-ghost absolute top-2 right-2 !px-2.5 !py-1 text-[10px] tracking-wide"
                    disabled={busy || !unlocked}
                    title={!unlocked ? "Unlock balances first" : "Refresh on-chain status"}
                    onClick={() => void onRefresh()}
                  >
                    <BusyLabel
                      busy={busyAction === "refresh"}
                      idle="Refresh"
                      busyText="…"
                    />
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-[var(--cream-dim)]">Spendable</p>
                      <p className="display text-2xl text-[var(--mint)]">{spendableLabel}</p>
                      <p className="text-[10px] text-[var(--cream-dim)]">withdraw / transfer</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--cream-dim)]">Receiving</p>
                      <p className="display text-2xl">{receivingLabel}</p>
                      <p className="text-[10px] text-[var(--cream-dim)]">merge to spend</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--cream-dim)]">
                  No confidential balance yet — register this account on the token first.
                </p>
              )}

              {registered === true && !unlocked ? (
                <button
                  type="button"
                  className="btn btn-primary w-full text-sm"
                  disabled={busy || !isolated}
                  onClick={() => void onUnlockBalances()}
                >
                  <BusyLabel
                    busy={busyAction === "unlock"}
                    idle="Unlock balances (Freighter)"
                    busyText="Unlocking…"
                  />
                </button>
              ) : null}
              {registered === true && unlocked ? (
                <p className="text-xs text-[var(--mint)]">Balances unlocked</p>
              ) : null}

              <button
                type="button"
                className="btn btn-primary w-full"
                disabled={busy || !isolated || registered === true}
                onClick={() => void onRegister()}
              >
                <BusyLabel
                  busy={busyAction === "register"}
                  idle={registered ? "Already registered" : "1. Register (ZK proof)"}
                  busyText="Registering…"
                />
              </button>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={amountXlm}
                  onChange={(e) => setAmountXlm(e.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!opsReady}
                  onClick={() => void onDeposit()}
                >
                  <BusyLabel
                    busy={busyAction === "deposit"}
                    idle="2. Deposit"
                    busyText="Depositing…"
                  />
                </button>
              </div>
              <button
                type="button"
                className="btn btn-ghost w-full text-sm"
                disabled={!opsReady}
                onClick={() => void onMerge()}
              >
                <BusyLabel
                  busy={busyAction === "merge"}
                  idle="Merge receiving → spendable"
                  busyText="Merging…"
                />
              </button>
            </div>
          )}
        </div>

        <div className="panel h-fit space-y-4 p-5">
          <p className="text-sm text-[var(--cream-dim)]">On-chain solvency (pool)</p>
          <CoverageTrafficLight
            ratio={
              solvency == null
                ? null
                : solvency.coverage_bps === 0
                  ? 0
                  : solvency.coverage_bps >= 0xffff_ffff
                    ? Number.POSITIVE_INFINITY
                    : solvency.coverage_bps / 10_000
            }
            panicHalt={solvency?.panic_halt}
          />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[var(--cream-dim)]">Assets B</p>
              <p className="display text-2xl">{solvency?.assets ?? "—"} XLM</p>
            </div>
            <div>
              <p className="text-[var(--cream-dim)]">Liabilities L</p>
              <p className="display text-2xl">{solvency?.liabilities ?? "—"} XLM</p>
            </div>
            <div>
              <p className="text-[var(--cream-dim)]">Panic</p>
              <p className="display text-2xl">
                {solvency == null ? "—" : solvency.panic_halt ? "HALT" : "open"}
              </p>
            </div>
          </div>
          <Link className="text-sm text-[var(--mint)] underline" href="/app/payroll">
            Payroll demo ledger →
          </Link>
        </div>

        {address ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
            <div className="panel space-y-3 p-5">
              <h2 className="display text-xl">3. Confidential transfer</h2>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--line)] bg-[var(--forest-deep)]/40 p-3">
                <div>
                  <p className="text-[10px] text-[var(--cream-dim)]">Spendable</p>
                  <p className="display text-xl text-[var(--mint)]">{spendableLabel}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--cream-dim)]">Receiving</p>
                  <p className="display text-xl">{receivingLabel}</p>
                </div>
              </div>
              <p className="text-xs text-[var(--cream-dim)]">
                Sends from spendable. Recipient must be registered; they Merge to spend.
              </p>
              <input
                className="input w-full font-mono text-sm"
                placeholder="Recipient G…"
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                disabled={busy}
              />
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  type="number"
                  min="0.0000001"
                  step="0.1"
                  value={transferXlm}
                  onChange={(e) => setTransferXlm(e.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!opsReady}
                  onClick={() => void onTransfer()}
                >
                  <BusyLabel
                    busy={busyAction === "transfer"}
                    idle="Transfer"
                    busyText="Proving…"
                  />
                </button>
              </div>
            </div>

            <div className="panel space-y-3 p-5">
              <h2 className="display text-xl">4. Withdraw</h2>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--line)] bg-[var(--forest-deep)]/40 p-3">
                <div>
                  <p className="text-[10px] text-[var(--cream-dim)]">Spendable</p>
                  <p className="display text-xl text-[var(--mint)]">{spendableLabel}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--cream-dim)]">Receiving</p>
                  <p className="display text-xl">{receivingLabel}</p>
                </div>
              </div>
              <p className="text-xs text-[var(--cream-dim)]">
                Spendable → public XLM. Amount becomes visible; solvency Hooks can revert.
                Paste your{" "}
                <Link href="/app/cross-border" className="text-[var(--mint)] underline">
                  Pollar cash-out
                </Link>{" "}
                receive address to fund bank offramp.
              </p>
              <input
                className="input w-full font-mono text-sm"
                placeholder="To G… (Pollar address or blank = you)"
                value={withdrawTo}
                onChange={(e) => setWithdrawTo(e.target.value)}
                disabled={busy}
              />
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  type="number"
                  min="0.0000001"
                  step="0.1"
                  value={withdrawXlm}
                  onChange={(e) => setWithdrawXlm(e.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!opsReady}
                  onClick={() => void onWithdraw()}
                >
                  <BusyLabel
                    busy={busyAction === "withdraw"}
                    idle="Withdraw"
                    busyText="Proving…"
                  />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {log.length > 0 && (
        <div className="panel p-4">
          <p className="mb-2 text-sm text-[var(--cream-dim)]">Log</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
            {log.map((l) => (
              <li
                key={l.t + l.text}
                className={
                  l.ok === false
                    ? "text-[var(--amber)]"
                    : l.ok
                      ? "text-[var(--mint)]"
                      : "text-[var(--cream-dim)]"
                }
              >
                {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
