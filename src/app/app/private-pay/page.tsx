"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/components/WalletProvider";
import { sppDocs, SPP_XLM_POOL_ID } from "@/lib/spp/config";
import {
  consumeSppAfterWipeFlag,
  createSppClient,
  isSppLockError,
  softReleaseSppRuntime,
  sppKeysMatch,
  stroopsToXlm,
  wipeSppLocalWalletAndReload,
  xlmToStroops,
  type SppSession,
} from "@/lib/spp/session";

export default function PrivatePayPage() {
  const wallet = useWallet();
  const [session, setSession] = useState<SppSession | null>(null);
  const [balance, setBalance] = useState<string>("—");
  const [amount, setAmount] = useState("1");
  const [recipient, setRecipient] = useState("");
  const [veilName, setVeilName] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [keyMismatch, setKeyMismatch] = useState(false);

  const push = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 16));
  }, []);

  const refreshBalance = useCallback(
    async (s: SppSession, ownerAddress?: string) => {
      try {
        push("Syncing pool events (needed to see notes from stealth Shield)…");
        await s.client.sync();
        const notes = await s.pool.notes();
        const unspent = notes.filter((n: { spent?: boolean }) => !n.spent);
        const b = await s.pool.balance();
        setBalance(stroopsToXlm(b));
        push(
          `Shielded balance ${stroopsToXlm(b)} XLM · ${unspent.length} unspent note(s) / ${notes.length} total`,
        );

        let mismatch = false;
        if (ownerAddress) {
          try {
            const local = await s.account.privacyKeys();
            const lookup = await s.client.recipientLookup(ownerAddress);
            const entry = lookup?.entry;
            if (entry && !sppKeysMatch(local, entry)) {
              mismatch = true;
              push(
                `Key mismatch — local note ${String(local.notePublicKey).slice(0, 14)}… vs registry ${String(entry.noteKey).slice(0, 14)}…`,
              );
            }
          } catch {
            /* ignore lookup errors */
          }
        }
        setKeyMismatch(mismatch);

        if (b === 0n) {
          if (mismatch) {
            push(
              "Notes encrypted to registry keys won’t decrypt here. Use Reset SPP wallet below, or Withdraw in the Nethermind demo (don’t clear that site’s data).",
            );
          } else {
            push(
              "Still 0 after sync — try Stealth → Reclaim on the burner, or Reset SPP wallet below.",
            );
          }
        }
      } catch (e) {
        setBalance("?");
        push(`balance: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [push],
  );

  const finishConnect = useCallback(
    async (address: string, fromWipe: boolean) => {
      setBusy(true);
      setError(null);
      push(
        fromWipe
          ? "Fresh wallet after OPFS wipe — approve Freighter “Privacy Pool Key Derivation [v2]” if prompted…"
          : "Booting SPP (WASM + circuits from CDN)…",
      );
      try {
        const s = await createSppClient({ userAddress: address });
        setSession(s);
        push(`Connected as ${address.slice(0, 6)}… · pool ${s.poolContract.slice(0, 8)}…`);
        if (fromWipe) {
          const local = await s.account.privacyKeys();
          for (let round = 1; round <= 4; round++) {
            push(`Sync round ${round}/4…`);
            await s.client.sync();
            const lookup = await s.client.recipientLookup(address);
            const entry = lookup?.entry;
            if (entry && sppKeysMatch(local, entry)) {
              setKeyMismatch(false);
              push("Local keys match on-chain registry");
            }
            const bal = await s.pool.balance();
            if (bal > 0n) {
              push(`Recovered shielded balance ${stroopsToXlm(bal)} XLM — Withdraw to Freighter`);
              break;
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
        await refreshBalance(s, address);
      } catch (e) {
        if (isSppLockError(e)) {
          setError(
            "SPP OPFS still locked. Close every other Veilpay tab, then click Reload page.",
          );
          await softReleaseSppRuntime();
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setBusy(false);
      }
    },
    [push, refreshBalance],
  );

  async function connectSpp() {
    if (!wallet.address) {
      setError("Connect Freighter on Testnet first");
      return;
    }
    await finishConnect(wallet.address, false);
  }

  async function resetSppWallet() {
    if (!wallet.address) return;
    if (
      !confirm(
        "Wipe this site’s SPP wallet and reload? Freighter will re-derive privacy keys after reload. Close other Veilpay tabs first.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setSession(null);
    push("Scheduling OPFS wipe on next load (releases Access Handle), then reloading…");
    try {
      await wipeSppLocalWalletAndReload();
      // page unloads — wipe runs before Storage.open on the new document
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  // After Reset → reload, auto-connect once Freighter address is ready.
  useEffect(() => {
    if (!wallet.address || !consumeSppAfterWipeFlag()) return;
    void finishConnect(wallet.address, true);
  }, [wallet.address, finishConnect]);

  async function runDeposit() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const stroops = xlmToStroops(amount);
      push(`Depositing ${amount} XLM (public ext_amount)…`);
      await session.pool.deposit(stroops);
      push("Deposit confirmed — note created in shielded pool");
      await refreshBalance(session, wallet.address ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resolveVeilRecipient() {
    if (!veilName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/names?name=${encodeURIComponent(veilName)}`);
      const data = await res.json();
      if (!data.ok || !data.record?.owner) throw new Error(data.error ?? "Name not found");
      setRecipient(data.record.owner);
      push(
        `Resolved ${data.record.fqdn} → owner ${data.record.owner.slice(0, 6)}… (SPP pays their registered G… privately)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runTransfer() {
    if (!session || !recipient) {
      setError("Set a recipient G… address (or resolve a .veil name)");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const stroops = xlmToStroops(amount);
      push(`Private transfer ${amount} XLM → ${recipient.slice(0, 6)}… (ext_amount 0 on-chain)`);
      // Prefer local keys when paying yourself / known session; address path uses registry.
      await session.pool.transfer(recipient, stroops);
      push("Private transfer submitted");
      await refreshBalance(session, wallet.address ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runWithdraw() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const stroops = xlmToStroops(amount);
      push(`Withdrawing ${amount} XLM to Freighter (public)`);
      await session.pool.withdraw(stroops);
      push("Withdraw confirmed");
      await refreshBalance(session, wallet.address ?? undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const onProgress = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { message?: string; stage?: string };
      if (detail?.message) push(`${detail.stage ?? "tx"}: ${detail.message}`);
    };
    window.addEventListener("stellar-private-payments:tx-progress", onProgress);
    return () => window.removeEventListener("stellar-private-payments:tx-progress", onProgress);
  }, [push]);

  return (
    <div className="space-y-6">
      <div>
        <p className="pill mb-3">Nethermind SPP · testnet</p>
        <h1 className="display text-4xl tracking-tight">Private payments</h1>
        <p className="mt-3 max-w-2xl text-[var(--cream-dim)]">
          Official Stellar privacy pools — deposit publicly, transfer privately inside the pool,
          withdraw publicly. Amounts and counterparties stay hidden on shielded transfers.{" "}
          <a
            className="text-[var(--mint)] underline"
            href={sppDocs.stellarPrivacy}
            target="_blank"
            rel="noreferrer"
          >
            developers.stellar.org/privacy
          </a>
        </p>
      </div>

      {error && (
        <div className="panel border-[rgba(232,106,92,0.35)] p-4 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {keyMismatch && (
        <div className="panel space-y-3 border-[rgba(232,180,92,0.45)] p-4 text-sm">
          <p className="text-[var(--amber)]">
            Registry keys ≠ this wallet, and the Nethermind demo also shows <strong>0</strong> on
            pool CAALK4… — the ~3.5 XLM notes are encrypted to privacy keys that no longer exist in
            either browser OPFS (likely wiped after the first registration). They can’t be decrypted
            from Freighter alone.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary !py-2 !px-4 text-sm"
              disabled={busy || !session}
              onClick={() => {
                setAmount("2");
                void runDeposit();
              }}
            >
              Deposit fresh XLM under these keys
            </button>
            <Link className="btn btn-ghost !py-2 !px-4 text-sm" href="/app/stealth">
              Stealth → Reclaim (only if burner still holds notes)
            </Link>
            <button
              type="button"
              className="btn btn-ghost !py-2 !px-4 text-sm"
              disabled={busy || !wallet.address}
              onClick={() => void resetSppWallet()}
            >
              Reset OPFS
            </button>
          </div>
          <p className="text-xs text-[var(--cream-dim)]">
            Testnet loss on the old note is expected after key wipe. New Shields/Deposits use{" "}
            <code>transferToKeys</code> / local derive so balances stay visible here.
          </p>
        </div>
      )}

      <div className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--cream-dim)]">
              Shielded balance (SPP pool — not Freighter)
            </p>
            <p className="display text-3xl">{balance} XLM</p>
            <p className="mt-1 text-xs text-[var(--cream-dim)]">
              After stealth Shield, funds land here. Use Withdraw to move XLM into Freighter.
            </p>
            <p className="mt-1 font-mono text-[10px] text-[var(--cream-dim)]">
              Pool {SPP_XLM_POOL_ID.slice(0, 12)}…
            </p>
          </div>
          {!session ? (
            <button
              className="btn btn-primary"
              disabled={busy || !wallet.address}
              onClick={() => void connectSpp()}
            >
              {busy ? "Starting…" : "Connect SPP pool"}
            </button>
          ) : (
            <button
              className="btn btn-ghost text-sm"
              disabled={busy}
              onClick={() => void refreshBalance(session, wallet.address ?? undefined)}
            >
              Refresh
            </button>
          )}
        </div>

        {!wallet.address && (
          <p className="text-sm text-[var(--amber)]">
            Connect Freighter on <strong>Testnet</strong> in the header.
          </p>
        )}

        <label className="block text-sm text-[var(--cream-dim)]">
          Amount (XLM)
          <input className="input mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary !py-2 !px-4 text-sm"
            disabled={busy || !session}
            onClick={() => void runDeposit()}
          >
            Deposit
          </button>
          <button
            className="btn btn-amber !py-2 !px-4 text-sm"
            disabled={busy || !session}
            onClick={() => void runTransfer()}
          >
            Private transfer
          </button>
          <button
            className="btn btn-ghost !py-2 !px-4 text-sm"
            disabled={busy || !session}
            onClick={() => void runWithdraw()}
          >
            Withdraw
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className="input font-mono text-xs"
            placeholder="Recipient G… (must be SPP-registered)"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-[180px]"
            placeholder="alice"
            value={veilName}
            onChange={(e) => setVeilName(e.target.value.toLowerCase())}
          />
          <span className="self-center text-sm text-[var(--mint)]">.veil</span>
          <button
            className="btn btn-ghost !py-2 !px-3 text-xs"
            disabled={busy}
            onClick={() => void resolveVeilRecipient()}
          >
            Resolve to owner
          </button>
        </div>
        <p className="text-xs text-[var(--cream-dim)]">
          Paying a <code>.veil</code> name via SPP uses the owner&apos;s Freighter address + on-chain
          public-key registry — transfer stays private inside the pool. Stealth pay pages remain for
          one-time public addresses.
        </p>
      </div>

      <div className="panel p-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-[var(--cream-dim)]">Activity</p>
        <ul className="max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-[var(--cream-dim)]">
          {log.length === 0 && <li>No ops yet</li>}
          {log.map((l, i) => (
            <li key={`${i}-${l.slice(0, 12)}`}>{l}</li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-[var(--cream-dim)]">
        Dev preview / unaudited.{" "}
        <a className="underline" href={sppDocs.demo} target="_blank" rel="noreferrer">
          Official demo
        </a>{" "}
        · <Link className="underline" href="/app/stealth">Veil names</Link>
        {session && (
          <>
            {" "}
            ·{" "}
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={() => void resetSppWallet()}
            >
              Reset SPP wallet
            </button>
          </>
        )}
      </p>
    </div>
  );
}
