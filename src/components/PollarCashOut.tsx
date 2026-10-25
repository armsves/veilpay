"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePollar } from "@pollar/react";
import { toast } from "react-toastify";
import Link from "next/link";
import { hasPollarKey, POLLAR_SANDBOX_ARS } from "@/lib/pollar/client";
import { useWallet } from "@/components/WalletProvider";
import {
  formatXlm,
  loadConfidentialBalanceSnap,
  peekConfidentialBalances,
  type ConfidentialBalanceSnap,
} from "@/lib/confidential/session";

type RouteStatus = {
  ok: boolean;
  routeCount?: number;
  dashboardHint?: string | null;
  error?: string;
};

function addressOf(wallet: { address?: string } | null): string | null {
  if (!wallet?.address) return null;
  return wallet.address;
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function PollarCashOut() {
  const keyOk = hasPollarKey();
  const [mounted, setMounted] = useState(false);
  const [sellRoutes, setSellRoutes] = useState<RouteStatus | null>(null);
  const [buyRoutes, setBuyRoutes] = useState<RouteStatus | null>(null);

  useEffect(() => setMounted(true), []);

  const refreshRoutes = useCallback(async () => {
    try {
      const [sellRes, buyRes] = await Promise.all([
        fetch("/api/pollar/routes?direction=offramp"),
        fetch("/api/pollar/routes?direction=onramp"),
      ]);
      setSellRoutes((await sellRes.json()) as RouteStatus);
      setBuyRoutes((await buyRes.json()) as RouteStatus);
    } catch (e) {
      const err = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
      setSellRoutes(err);
      setBuyRoutes(err);
    }
  }, []);

  useEffect(() => {
    void refreshRoutes();
  }, [refreshRoutes]);

  if (!keyOk) {
    return (
      <div className="panel flex min-h-0 flex-1 items-center p-4 text-sm text-[var(--danger)]">
        Missing <code className="mx-1">NEXT_PUBLIC_POLLAR_KEY</code>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className="panel flex min-h-0 flex-1 items-center p-4 text-sm text-[var(--cream-dim)]">
        Loading Pollar…
      </div>
    );
  }

  return (
    <PollarCashOutInner
      sellRoutes={sellRoutes}
      buyRoutes={buyRoutes}
      onRefreshRoutes={refreshRoutes}
    />
  );
}

function PollarCashOutInner({
  sellRoutes,
  buyRoutes,
  onRefreshRoutes,
}: {
  sellRoutes: RouteStatus | null;
  buyRoutes: RouteStatus | null;
  onRefreshRoutes: () => void;
}) {
  const freighter = useWallet();
  const {
    isAuthenticated,
    wallet,
    wallets,
    openLoginModal,
    openKycModal,
    openRampModal,
    openReceiveModal,
    openWalletBalanceModal,
    openEnabledAssetsModal,
    setTrustline,
    logout,
    verified,
    refreshWalletBalance,
    refreshAssets,
    walletBalance,
    enabledAssets,
  } = usePollar();

  const [confSnap, setConfSnap] = useState<ConfidentialBalanceSnap | null>(null);
  const [confBusy, setConfBusy] = useState(false);
  const [confErr, setConfErr] = useState<string | null>(null);
  const [trustBusy, setTrustBusy] = useState(false);
  const peekedFor = useRef<string | null>(null);

  const arsTrustline =
    enabledAssets.step === "loaded"
      ? enabledAssets.data.assets.find(
          (a) =>
            a.code === POLLAR_SANDBOX_ARS.code &&
            a.issuer === POLLAR_SANDBOX_ARS.issuer,
        )
      : undefined;
  /** On-chain line ready, or asset missing from app catalog (dashboard not configured). */
  const arsInCatalog = Boolean(arsTrustline);
  const arsLineReady = Boolean(arsTrustline?.trustlineEstablished);

  const address = addressOf(wallet) ?? wallets.map((w) => addressOf(w)).find(Boolean) ?? null;
  const sellReady = Boolean(sellRoutes?.ok && (sellRoutes.routeCount ?? 0) > 0);
  const buyReady = Boolean(buyRoutes?.ok && (buyRoutes.routeCount ?? 0) > 0);

  const refreshConf = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!freighter.address) {
        setConfSnap(null);
        setConfErr(null);
        return;
      }
      setConfBusy(true);
      setConfErr(null);
      try {
        const bal = await peekConfidentialBalances(freighter.address);
        setConfSnap({
          spendable: formatXlm(bal.spendable),
          receiving: formatXlm(bal.receiving),
          available: formatXlm(bal.spendable + bal.receiving),
          at: Date.now(),
        });
        if (!opts?.silent) toast.success("Confidential balance updated");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfErr(msg);
        if (!opts?.silent) toast.error(msg);
      } finally {
        setConfBusy(false);
      }
    },
    [freighter.address],
  );

  useEffect(() => {
    if (!freighter.address) {
      setConfSnap(null);
      peekedFor.current = null;
      return;
    }
    setConfSnap(loadConfidentialBalanceSnap(freighter.address));
    if (peekedFor.current === freighter.address) return;
    peekedFor.current = freighter.address;
    void refreshConf({ silent: true });
  }, [freighter.address, refreshConf]);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Pollar receive address copied");
    } catch {
      toast.error("Could not copy address");
    }
  };

  const runKyc = () => {
    if (!isAuthenticated) {
      openLoginModal();
      toast.info("Sign in to Pollar first, then complete KYC");
      return;
    }
    // App-level KYC (Integrations → KYC) is optional. Pollar Sandbox Sell ARS is
    // HOSTED SEP-24 — identity + bank details run inside the ramp widget.
    openKycModal({
      onApproved: () => toast.success("KYC approved — you can cash out"),
    });
  };

  const ensureArsTrustline = async (): Promise<boolean> => {
    if (!isAuthenticated) {
      openLoginModal();
      toast.info("Sign in to Pollar first");
      return false;
    }
    setTrustBusy(true);
    try {
      await refreshAssets();
      const outcome = await setTrustline({
        code: POLLAR_SANDBOX_ARS.code,
        issuer: POLLAR_SANDBOX_ARS.issuer,
      });
      if (outcome.status === "error") {
        toast.error(
          outcome.details ??
            outcome.code ??
            "Could not add ARS trustline — enable ARS under Dashboard → Tokens & Trustlines",
        );
        openEnabledAssetsModal();
        return false;
      }
      if (outcome.status === "cosign_pending" || outcome.status === "pending") {
        toast.info("Approve the ARS trustline in the Pollar prompt, then retry Get test ARS");
        return false;
      }
      await refreshAssets();
      await refreshWalletBalance();
      toast.success("ARS trustline ready — try Get test ARS again");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      openEnabledAssetsModal();
      return false;
    } finally {
      setTrustBusy(false);
    }
  };

  const openRamp = async (kind: "buy" | "sell") => {
    if (!isAuthenticated) {
      openLoginModal();
      toast.info("Sign in to Pollar first");
      return;
    }
    if (kind === "sell" && !sellReady) {
      toast.error(
        sellRoutes?.dashboardHint ??
          "No Sell corridor — enable Pollar Sandbox Sell ARS in the dashboard",
      );
      return;
    }
    if (kind === "buy" && !buyReady) {
      toast.error("No Buy corridor — enable Pollar Sandbox Buy ARS in the dashboard");
      return;
    }
    if (kind === "buy" && !arsLineReady) {
      const ok = await ensureArsTrustline();
      if (!ok) return;
    }
    openRampModal();
    toast.info(
      kind === "buy"
        ? "Pick Buy · AR · ARS in the ramp"
        : "Pick Sell · AR · ARS to cash out to the sandbox bank",
    );
  };

  const runOfframp = () => void openRamp("sell");
  const runOnramp = () => void openRamp("buy");

  useEffect(() => {
    if (!isAuthenticated) return;
    void refreshAssets();
  }, [isAuthenticated, refreshAssets]);

  const balPreview =
    walletBalance.step === "loaded"
      ? walletBalance.data.balances
          .filter((b) => b.balance && b.balance !== "0")
          .slice(0, 3)
          .map((b) => `${b.code} ${b.balance}`)
          .join(" · ")
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <section className="panel flex shrink-0 flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-[var(--cream-dim)]">
            Available to cash out
          </p>
          {freighter.address ? (
            <>
              <p className="display text-2xl leading-none tracking-tight text-[var(--mint)]">
                {confSnap?.available ?? (confBusy ? "…" : "—")}{" "}
                <span className="text-base text-[var(--cream-dim)]">XLM conf.</span>
              </p>
              <p className="mt-1 text-[11px] text-[var(--cream-dim)]">
                {confSnap
                  ? `Spendable ${confSnap.spendable} · receiving ${confSnap.receiving} · Freighter ${shortAddr(freighter.address)}`
                  : confBusy
                    ? "Approve Freighter to decode openings…"
                    : "Unlock openings to see balance"}
              </p>
              {confErr ? (
                <p className="mt-0.5 truncate text-[10px] text-[var(--danger)]">{confErr}</p>
              ) : null}
            </>
          ) : (
            <>
              <p className="display text-2xl leading-none tracking-tight text-[var(--cream-dim)]">
                —
              </p>
              <p className="mt-1 text-[11px] text-[var(--cream-dim)]">
                Connect Freighter (header) to read confidential balance
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {freighter.address ? (
            <button
              type="button"
              className="btn btn-ghost !px-2.5 !py-1.5 text-xs"
              disabled={confBusy}
              onClick={() => void refreshConf()}
            >
              {confBusy ? "Reading…" : "Refresh balance"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost !px-2.5 !py-1.5 text-xs"
              disabled={freighter.connecting}
              onClick={() => void freighter.connect()}
            >
              Connect Freighter
            </button>
          )}
          <Link href="/app/confidential" className="btn btn-ghost !px-2.5 !py-1.5 text-xs">
            Confidential
          </Link>
        </div>
      </section>

      <div className="grid shrink-0 gap-2 sm:grid-cols-3 sm:items-start">
        <section className="panel flex flex-col gap-2 p-3">
          <h2 className="display text-lg leading-none tracking-tight">1 · Account</h2>
          <p className="text-xs leading-snug text-[var(--cream-dim)]">
            Pollar TestNet wallet that receives ARS for cash-out.
          </p>
          {isAuthenticated && address ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="pill pill-ok !py-0.5 text-[10px]">
                  {verified ? "Signed in" : "Signing in…"}
                </span>
                <button
                  type="button"
                  className="text-[10px] text-[var(--cream-dim)] underline"
                  onClick={() => logout()}
                >
                  Sign out
                </button>
              </div>
              <button
                type="button"
                className="truncate text-left font-mono text-xs text-[var(--mint)]"
                title={address}
                onClick={() => void copyAddress()}
              >
                {shortAddr(address)}
              </button>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() => void copyAddress()}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="btn btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() => openReceiveModal()}
                >
                  QR
                </button>
                <button
                  type="button"
                  className="btn btn-ghost !px-2 !py-1 text-[11px]"
                  onClick={() => {
                    void refreshWalletBalance();
                    openWalletBalanceModal();
                  }}
                >
                  Balances
                </button>
              </div>
              {balPreview ? (
                <p className="truncate text-[11px] text-[var(--cream-dim)]">{balPreview}</p>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary !py-1.5 text-sm"
              onClick={() => openLoginModal()}
            >
              Sign in with Pollar
            </button>
          )}
        </section>

        <section className="panel flex flex-col gap-2 p-3">
          <h2 className="display text-lg leading-none tracking-tight">2 · KYC</h2>
          <p className="text-xs leading-snug text-[var(--cream-dim)]">
            Sandbox verifies inside <strong>Cash out</strong> (hosted). Standalone
            providers need Dashboard → Integrations → KYC.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn btn-ghost !py-1.5 text-xs" onClick={runKyc}>
              App KYC
            </button>
            <button
              type="button"
              className="btn btn-amber flex-1 !py-1.5 text-sm"
              onClick={runOfframp}
              disabled={!sellReady && isAuthenticated}
            >
              Verify in cash out
            </button>
          </div>
        </section>

        <section className="panel flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="display text-lg leading-none tracking-tight">3 · Bank</h2>
            <div className="flex flex-wrap gap-1">
              {buyRoutes == null || sellRoutes == null ? (
                <span className="pill !py-0.5 text-[10px]">…</span>
              ) : (
                <>
                  <span className={`pill !py-0.5 text-[10px] ${buyReady ? "pill-ok" : "pill-danger"}`}>
                    {buyReady ? "ARS buy" : "No buy"}
                  </span>
                  <span className={`pill !py-0.5 text-[10px] ${sellReady ? "pill-ok" : "pill-danger"}`}>
                    {sellReady ? "ARS sell" : "No sell"}
                  </span>
                  <span
                    className={`pill !py-0.5 text-[10px] ${arsLineReady ? "pill-ok" : "pill-danger"}`}
                  >
                    {arsLineReady ? "ARS line ✓" : arsInCatalog ? "No ARS line" : "ARS not in app"}
                  </span>
                </>
              )}
            </div>
          </div>
          <p className="text-xs leading-snug text-[var(--cream-dim)]">
            {arsInCatalog
              ? "Add ARS line, Get test ARS (Buy), then Cash out (Sell)."
              : "Dashboard → Tokens & Trustlines → add ARS:GCLAJ3… then Add ARS line."}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-1.5 text-xs"
              onClick={() => onRefreshRoutes()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-amber !px-2 !py-1.5 text-xs"
              disabled={trustBusy || arsLineReady}
              onClick={() => void ensureArsTrustline()}
            >
              {trustBusy ? "Adding…" : arsLineReady ? "ARS line OK" : "Add ARS line"}
            </button>
            <button
              type="button"
              className="btn btn-ghost !px-2 !py-1.5 text-xs"
              onClick={runOnramp}
              disabled={!buyReady && isAuthenticated}
            >
              Get test ARS
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1 !py-1.5 text-sm"
              onClick={runOfframp}
              disabled={!sellReady && isAuthenticated}
            >
              Cash out
            </button>
          </div>
          {!sellReady && sellRoutes?.dashboardHint ? (
            <p className="line-clamp-2 text-[10px] text-[var(--amber)]">{sellRoutes.dashboardHint}</p>
          ) : null}
          {sellRoutes?.error ? (
            <p className="truncate text-[10px] text-[var(--danger)]">{sellRoutes.error}</p>
          ) : null}
        </section>
      </div>

      <section className="panel flex shrink-0 items-center gap-3 overflow-hidden p-3">
        <p className="shrink-0 display text-base leading-none tracking-tight">Path</p>
        <p className="min-w-0 truncate text-xs text-[var(--cream-dim)]">
          Get test ARS (Buy) →{" "}
          <Link href="/app/confidential" className="text-[var(--mint)] underline">
            Confidential
          </Link>
          {" withdraw optional → Sell ARS → sandbox bank"}
        </p>
      </section>
    </div>
  );
}
