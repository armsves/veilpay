"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/WalletProvider";
import { MIN_SHIELD_BALANCE_XLM, shieldStealthViaSpp } from "@/lib/spp/shield";

type Meta = { encoded: string; spendingPubKey: string; viewingPubKey: string };
type Payment = { stealthAddress: string; ephemeralPubKey: string; viewTag: number; memoHint: string };
type NameRecord = {
  name: string;
  fqdn: string;
  owner: string;
  payUrl: string;
  resolveCount: number;
  metaEncoded: string;
};

type InboxItem = {
  id: string;
  index?: number;
  stealthAddress: string;
  memoHint: string;
  createdAt: number;
  swept: boolean;
  balanceXlm: number;
};

export default function StealthPage() {
  const wallet = useWallet();
  const [desiredName, setDesiredName] = useState("");
  const [availability, setAvailability] = useState<string | null>(null);
  const [myName, setMyName] = useState<NameRecord | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [resolvedPay, setResolvedPay] = useState<{
    stealthAddress: string;
    memoHint: string;
  } | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [intentsQuote, setIntentsQuote] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadMyName = useCallback(async () => {
    if (!wallet.address) {
      setMyName(null);
      setInbox([]);
      return;
    }
    const res = await fetch(
      `/api/names?action=inbox&owner=${encodeURIComponent(wallet.address)}`,
    );
    const data = await res.json();
    setMyName(data.record ?? null);
    setInbox(data.inbox ?? []);
  }, [wallet.address]);

  useEffect(() => {
    void loadMyName();
  }, [loadMyName]);

  async function sweepItem(item: InboxItem) {
    if (!wallet.address) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sweep",
          owner: wallet.address,
          announcementId: item.id.startsWith("idx_") ? undefined : item.id,
          index: item.index,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      if (data.balanceXlm < MIN_SHIELD_BALANCE_XLM) {
        setStatus(
          `Stealth has ${data.balanceXlm} XLM — need ≥${MIN_SHIELD_BALANCE_XLM} XLM to SPP-shield (1 XLM reserve + 0.5 XLM fees + ≥1 XLM deposit). Top up this burner or pay a fresh address.`,
        );
        return;
      }
      const result = await shieldStealthViaSpp({
        stealthSecret: data.stealthSecret,
        stealthAddress: data.stealthAddress,
        ownerAddress: wallet.address,
        onProgress: (msg) => setStatus(msg),
      });
      await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "markSwept",
          owner: wallet.address,
          index: data.index ?? item.index,
          announcementId: item.id.startsWith("idx_") ? undefined : item.id,
        }),
      });
      setStatus(
        `Shielded ${result.transferredXlm} XLM into your SPP private pool (not visible in Freighter yet). Open Private pay → Connect SPP → Withdraw to move it to your wallet. ~${result.leftoverXlm.toFixed(2)} XLM stays on the burner as reserve.`,
      );
      await loadMyName();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function scanSweepAll() {
    if (!wallet.address) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scanSweep", owner: wallet.address }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const ready = (data.ready ?? []) as Array<{
        index: number;
        address: string;
        secret: string;
        balanceXlm: number;
      }>;
      if (ready.length === 0) {
        setStatus(data.note);
        return;
      }
      let shielded = 0;
      for (const c of ready) {
        setStatus(`Shielding #${c.index} (${c.balanceXlm} XLM) via SPP…`);
        const result = await shieldStealthViaSpp({
          stealthSecret: c.secret,
          stealthAddress: c.address,
          ownerAddress: wallet.address,
          onProgress: (msg) => setStatus(`#${c.index}: ${msg}`),
        });
        shielded += Number(result.transferredXlm);
        await fetch("/api/names", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "markSwept",
            owner: wallet.address,
            index: c.index,
          }),
        });
      }
      setStatus(
        `SPP-shielded ${shielded} XLM from ${ready.length} address(es) into your private pool balance.`,
      );
      await loadMyName();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const name = desiredName.trim();
    if (name.length < 3) {
      setAvailability(null);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/names?action=available&name=${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.error) setAvailability(d.error);
          else if (d.available) setAvailability(`${d.fqdn} is available`);
          else setAvailability(`${d.fqdn} is taken`);
        });
    }, 280);
    return () => clearTimeout(t);
  }, [desiredName]);

  async function registerName() {
    if (!wallet.address) {
      setError("Connect Freighter to register a .veil name");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          name: desiredName,
          owner: wallet.address,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setMyName(data.record);
      setStatus(`Registered ${data.record.fqdn}`);
      setDesiredName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function previewResolve() {
    if (!myName) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", name: myName.name }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setResolvedPay({ stealthAddress: data.stealthAddress, memoHint: data.memoHint });
      setMyName((n) => (n ? { ...n, resolveCount: data.resolveCount } : n));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createTestnetMeta() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stealth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_testnet_meta" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setMeta(data.meta);
      setPayment(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function generatePayment() {
    if (!meta) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stealth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_payment", meta: meta.encoded }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setPayment(data.payment);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function quoteMainnetIntents() {
    if (!wallet.address) {
      setError("Connect Freighter first — payout goes to your connected wallet");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stealth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mainnet_intents_quote",
          amount: "50000000",
          confidentiality: "basic",
          recipient: wallet.address,
        }),
      });
      const raw = await res.text();
      const data = raw
        ? (JSON.parse(raw) as { ok?: boolean; error?: string; quote?: Record<string, unknown> })
        : {};
      if (!data.ok) throw new Error(data.error ?? `Quote failed (${res.status})`);
      setIntentsQuote(data.quote ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="pill mb-3">Veilpay Name Service</p>
        <h1 className="display text-4xl tracking-tight">Stealth names</h1>
        <p className="mt-3 max-w-2xl text-[var(--cream-dim)]">
          Like Fluidkey&apos;s <code className="text-[var(--mint)]">*.fkey.eth</code> — register{" "}
          <code className="text-[var(--mint)]">you.veil</code>. Every resolve returns a fresh stealth
          address; your Freighter key stays private.
        </p>
      </div>

      {(error || status) && (
        <div
          className={`panel space-y-2 p-4 ${error ? "border-[rgba(232,106,92,0.35)] text-[var(--danger)]" : "text-[var(--mint)]"}`}
        >
          <p>{error ?? status}</p>
          {!error && status?.includes("SPP") && (
            <Link className="btn btn-primary !py-1.5 !px-3 text-xs" href="/app/private-pay">
              Open Private pay → Withdraw
            </Link>
          )}
        </div>
      )}

      <section className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-2xl">Claim your .veil</h2>
          <span className="pill">VNS</span>
        </div>

        {myName ? (
          <div className="space-y-3">
            <p className="display text-3xl tracking-tight">
              {myName.name}
              <span className="text-[var(--mint)]">.veil</span>
            </p>
            <p className="break-all text-xs text-[var(--cream-dim)]">Owner {myName.owner}</p>
            <p className="text-sm text-[var(--cream-dim)]">
              Share{" "}
              <Link className="text-[var(--mint)] underline" href={myName.payUrl}>
                {typeof window !== "undefined" ? window.location.origin : ""}
                {myName.payUrl}
              </Link>{" "}
              · resolved {myName.resolveCount}×
            </p>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary !py-2 !px-4 text-sm" disabled={busy} onClick={() => void previewResolve()}>
                Resolve fresh address
              </button>
              <Link className="btn btn-ghost !py-2 !px-4 text-sm" href={myName.payUrl}>
                Open pay page
              </Link>
            </div>
            {resolvedPay && (
              <div className="break-all rounded-xl bg-black/25 p-3 text-xs">
                <p className="text-[var(--cream-dim)]">One-time receive</p>
                <p className="text-[var(--mint)]">{resolvedPay.stealthAddress}</p>
                <p className="mt-1 text-[var(--cream-dim)]">Memo hint: {resolvedPay.memoHint}</p>
              </div>
            )}

            <div className="border-t border-[var(--line)] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-[var(--cream-dim)]">
                  Senders pay a one-time address. Shield deposits into the SPP pool from the burner,
                  then privately transfers to you — never a public payment to Freighter.
                </p>
                <button
                  type="button"
                  className="btn btn-amber !py-1.5 !px-3 text-xs"
                  disabled={busy}
                  onClick={() => void scanSweepAll()}
                >
                  {busy ? "Shielding…" : "Scan & shield (SPP)"}
                </button>
              </div>
              <ul className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {inbox.length === 0 && (
                  <li className="text-xs text-[var(--cream-dim)]">
                    Inbox empty — open your pay page so a resolve is logged, then wait for a deposit.
                  </li>
                )}
                {inbox.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-2.5 py-2 text-xs"
                  >
                    <div className="min-w-0 break-all">
                      <p className="font-mono text-[var(--mint)]">{item.stealthAddress}</p>
                      <p className="text-[var(--cream-dim)]">
                        {item.balanceXlm} XLM
                        {item.index != null ? ` · #${item.index}` : ""} ·{" "}
                        {item.swept ? "swept" : "open"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary !py-1 !px-2.5 text-[10px]"
                      disabled={busy || item.swept || item.balanceXlm < MIN_SHIELD_BALANCE_XLM}
                      onClick={() => void sweepItem(item)}
                      title={
                        item.balanceXlm < MIN_SHIELD_BALANCE_XLM
                          ? `Need ≥${MIN_SHIELD_BALANCE_XLM} XLM to shield`
                          : "SPP deposit + private transfer"
                      }
                    >
                      Shield
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!wallet.address && (
              <p className="text-sm text-[var(--amber)]">Connect Freighter to register</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <input
                  className="input !pr-14"
                  placeholder="alice"
                  value={desiredName}
                  onChange={(e) => setDesiredName(e.target.value.toLowerCase())}
                  maxLength={16}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--mint)]">
                  .veil
                </span>
              </div>
              <button
                className="btn btn-primary !py-2 !px-4 text-sm"
                disabled={busy || !wallet.address || desiredName.length < 3}
                onClick={() => void registerName()}
              >
                Register
              </button>
            </div>
            {availability && (
              <p
                className={`text-xs ${
                  availability.includes("available") ? "text-[var(--mint)]" : "text-[var(--cream-dim)]"
                }`}
              >
                {availability}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="display text-xl">Low-level stealth tools</h2>
            <span className="pill">SPP / DKSAP</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost !py-1.5 !px-3 text-xs" disabled={busy} onClick={createTestnetMeta}>
              Create meta-address
            </button>
            <button
              className="btn btn-ghost !py-1.5 !px-3 text-xs"
              disabled={busy || !meta}
              onClick={generatePayment}
            >
              One-time receive
            </button>
          </div>
          {meta && (
            <p className="break-all text-[10px] text-[var(--cream-dim)]">{meta.encoded}</p>
          )}
          {payment && (
            <p className="break-all text-[10px] text-[var(--mint)]">{payment.stealthAddress}</p>
          )}
        </section>

        <section className="panel space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="display text-xl">Confidential XLM</h2>
            <span className="pill">Aurora</span>
          </div>
          <p className="text-xs text-[var(--cream-dim)]">
            One-time deposit → payout to connected Freighter
          </p>
          <button
            className="btn btn-amber !py-1.5 !px-3 text-xs"
            disabled={busy || !wallet.address}
            onClick={() => void quoteMainnetIntents()}
          >
            Get XLM deposit address
          </button>
          {intentsQuote && (
            <div className="break-all text-[10px] text-[var(--cream-dim)]">
              <p className="text-[var(--mint)]">{String(intentsQuote.depositAddress)}</p>
              <p>Memo: {String(intentsQuote.memo ?? "—")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
