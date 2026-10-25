"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/components/WalletProvider";
import { explorerTxUrl, sendXlm } from "@/lib/stellar/send-xlm";

type ResolveResult = {
  fqdn: string;
  stealthAddress: string;
  memoHint: string;
  viewTag: number;
  resolveCount: number;
  announcementId?: string;
};

export default function PayByNamePage() {
  const params = useParams<{ name: string }>();
  const name = params.name ?? "";
  const wallet = useWallet();
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [amount, setAmount] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    if (!name) return;
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const res = await fetch("/api/names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", name }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setResult({
        fqdn: data.fqdn,
        stealthAddress: data.stealthAddress,
        memoHint: data.memoHint,
        viewTag: data.viewTag,
        resolveCount: data.resolveCount,
        announcementId: data.announcementId,
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [name]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  async function pay() {
    if (!result) return;
    if (!wallet.address) {
      setError("Connect Freighter to send XLM");
      return;
    }
    if (wallet.mismatch) {
      setError("Switch Freighter to Testnet");
      return;
    }
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const sent = await sendXlm({
        from: wallet.address,
        to: result.stealthAddress,
        amount,
      });
      setTxHash(sent.hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col veil-noise">
      <header className="mx-auto flex w-full max-w-lg items-center justify-between px-5 py-5">
        <Link href="/" className="display text-xl tracking-tight">
          Veil<span className="text-[var(--mint)]">pay</span>
        </Link>
        <WalletButton compact />
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16">
        <p className="pill mb-4 w-fit">Private pay · stealth resolve</p>
        <h1 className="display text-4xl tracking-tight">
          {name}
          <span className="text-[var(--mint)]">.veil</span>
        </h1>
        <p className="mt-3 text-[var(--cream-dim)]">
          Enter an amount and pay from Freighter — funds land on a one-time address only the
          recipient can sweep.
        </p>

        {error && (
          <div className="mt-6 panel border-[rgba(232,106,92,0.35)] p-4 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        {txHash && (
          <div className="mt-6 panel border-[rgba(110,231,183,0.35)] p-4 text-sm text-[var(--mint)]">
            Sent {amount} XLM ·{" "}
            <a className="underline" href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </div>
        )}

        {result && (
          <div className="panel mt-6 space-y-4 p-5">
            <label className="block text-sm text-[var(--cream-dim)]">
              Amount (XLM)
              <input
                className="input mt-1 text-lg"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
                aria-label="XLM amount"
              />
            </label>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-[var(--cream-dim)]">
                One-time receive address
              </p>
              <p className="mt-1 break-all font-mono text-xs text-[var(--mint)]">
                {result.stealthAddress}
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={busy || !result}
              onClick={() => {
                if (!wallet.address) {
                  void wallet.connect();
                  return;
                }
                void pay();
              }}
            >
              {busy
                ? "Confirm in Freighter…"
                : !wallet.address
                  ? "Connect Freighter to pay"
                  : `Pay ${amount || "…"} XLM`}
            </button>

            <button
              type="button"
              className="btn btn-ghost w-full text-sm"
              disabled={busy}
              onClick={() => void resolve()}
            >
              New one-time address
            </button>

            <p className="text-xs text-[var(--cream-dim)]">
              First payment to a fresh address needs ≥1 XLM (account creation). Owner never reveals
              their Freighter address on this page.
            </p>
          </div>
        )}

        {!result && !error && (
          <p className="mt-8 text-sm text-[var(--cream-dim)]">Resolving {name}.veil…</p>
        )}
      </main>
    </div>
  );
}
