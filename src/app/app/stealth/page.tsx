"use client";

import { useState } from "react";

type Meta = { encoded: string; spendingPubKey: string; viewingPubKey: string };
type Payment = { stealthAddress: string; ephemeralPubKey: string; viewTag: number; memoHint: string };

export default function StealthPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [intentsQuote, setIntentsQuote] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stealth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mainnet_intents_quote",
          amount: "25000000",
          confidentiality: "basic",
          recipient: "0xVeilpayDemoRecipient000000000000000001",
          refundTo: "GVEILPAYREFUND0000000000000000000000000000000000000",
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setIntentsQuote(data.quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="pill mb-3">Two separate stealth modules</p>
        <h1 className="display text-4xl tracking-tight">Stealth addresses</h1>
        <p className="mt-3 max-w-2xl text-[var(--cream-dim)]">
          Testnet uses Stellar privacy tooling (DKSAP-style + SPP-compatible). Mainnet path adds
          Confidential NEAR Intents so deposit and withdraw cannot be matched publicly.
        </p>
      </div>

      {error && (
        <div className="panel border-[rgba(232,106,92,0.35)] p-4 text-[var(--danger)]">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="display text-2xl">Testnet · Stellar tools</h2>
            <span className="pill">SPP / DKSAP</span>
          </div>
          <p className="mt-2 text-sm text-[var(--cream-dim)]">
            Aligns with{" "}
            <a className="text-[var(--mint)] underline" href="https://developers.stellar.org/docs/build/apps/privacy">
              developers.stellar.org privacy docs
            </a>
            .
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={createTestnetMeta}>
              Create meta-address
            </button>
            <button className="btn btn-ghost" disabled={busy || !meta} onClick={generatePayment}>
              Generate one-time receive
            </button>
          </div>
          {meta && (
            <div className="mt-5 space-y-2 break-all rounded-xl bg-black/25 p-4 text-xs">
              <p className="text-[var(--cream-dim)]">Meta</p>
              <code>{meta.encoded}</code>
            </div>
          )}
          {payment && (
            <div className="mt-4 space-y-2 break-all rounded-xl bg-black/25 p-4 text-xs">
              <p className="text-[var(--cream-dim)]">Stealth payment</p>
              <p>Address: {payment.stealthAddress}</p>
              <p>View tag: {payment.viewTag}</p>
              <p>Memo hint: {payment.memoHint}</p>
            </div>
          )}
        </section>

        <section className="panel p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="display text-2xl">Mainnet · Confidential Intents</h2>
            <span className="pill">NEAR</span>
          </div>
          <p className="mt-2 text-sm text-[var(--cream-dim)]">
            Quote a confidential Stellar → Base USDC path. Set <code>NEAR_INTENTS_JWT</code> for live
            1Click quotes.
          </p>
          <div className="mt-5">
            <button className="btn btn-amber" disabled={busy} onClick={quoteMainnetIntents}>
              Quote confidential transfer
            </button>
          </div>
          {intentsQuote && (
            <div className="mt-4 space-y-2 break-all rounded-xl bg-black/25 p-4 text-xs">
              <p>Deposit: {String(intentsQuote.depositAddress)}</p>
              <p>Memo: {String(intentsQuote.memo ?? "—")}</p>
              <p>Mode: {String(intentsQuote.confidentiality)}</p>
              <p className="text-[var(--cream-dim)]">{String(intentsQuote.note)}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
