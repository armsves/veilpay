"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletButton, usePollar } from "@pollar/react";
import { toast } from "react-toastify";
import Link from "next/link";
import { hasPollarKey } from "@/lib/pollar/client";

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

export function PollarCashOut() {
  const keyOk = hasPollarKey();
  const [mounted, setMounted] = useState(false);
  const [routes, setRoutes] = useState<RouteStatus | null>(null);

  useEffect(() => setMounted(true), []);

  const refreshRoutes = useCallback(async () => {
    try {
      const res = await fetch("/api/pollar/routes?direction=offramp");
      const data = (await res.json()) as RouteStatus;
      setRoutes(data);
    } catch (e) {
      setRoutes({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refreshRoutes();
  }, [refreshRoutes]);

  if (!keyOk) {
    return (
      <div className="panel p-5">
        <p className="text-sm text-[var(--danger)]">
          Missing <code>NEXT_PUBLIC_POLLAR_KEY</code>. Add the TestNet publishable
          key from dashboard.pollar.xyz → Build → API Keys.
        </p>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className="panel p-5 text-sm text-[var(--cream-dim)]">Loading Pollar…</div>
    );
  }

  return <PollarCashOutInner routes={routes} onRefreshRoutes={refreshRoutes} />;
}

function PollarCashOutInner({
  routes,
  onRefreshRoutes,
}: {
  routes: RouteStatus | null;
  onRefreshRoutes: () => void;
}) {
  const {
    isAuthenticated,
    wallet,
    wallets,
    openLoginModal,
    openKycModal,
    openRampModal,
    openReceiveModal,
    openWalletBalanceModal,
    logout,
    verified,
    refreshWalletBalance,
    walletBalance,
  } = usePollar();

  const address = addressOf(wallet) ?? wallets.map((w) => addressOf(w)).find(Boolean) ?? null;
  const routeCount = routes?.routeCount ?? 0;
  const routesReady = Boolean(routes?.ok && routeCount > 0);

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
    openKycModal({
      country: "AR",
      onApproved: () => toast.success("KYC approved — you can cash out"),
    });
  };

  const runOfframp = () => {
    if (!isAuthenticated) {
      openLoginModal();
      toast.info("Sign in to Pollar first");
      return;
    }
    if (!routesReady) {
      toast.error(
        routes?.dashboardHint ??
          "No offramp corridors enabled — turn on a Sell provider in the Pollar dashboard",
      );
      return;
    }
    openRampModal();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="panel flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="display text-xl tracking-tight">1 · Pollar account</h2>
              <p className="mt-1 text-sm text-[var(--cream-dim)]">
                Sign in (Google / email). Pollar provisions a TestNet Stellar wallet —
                that G… address receives transparent tokens after confidential unwrap.
              </p>
            </div>
            <div className="pollar-wallet-slot shrink-0">
              <WalletButton />
            </div>
          </div>

          {isAuthenticated && address ? (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--ink-2)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="pill pill-ok">
                  {verified ? "Session verified" : "Signing in…"}
                </span>
                <button type="button" className="btn btn-ghost !py-1 !px-2 text-xs" onClick={() => logout()}>
                  Sign out
                </button>
              </div>
              <p className="mt-2 text-xs uppercase tracking-wide text-[var(--cream-dim)]">
                Receive address (registered)
              </p>
              <code className="mt-1 block break-all text-sm text-[var(--mint)]">{address}</code>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-xs" onClick={() => void copyAddress()}>
                  Copy address
                </button>
                <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-xs" onClick={() => openReceiveModal()}>
                  Show QR
                </button>
                <button
                  type="button"
                  className="btn btn-ghost !py-1.5 !px-3 text-xs"
                  onClick={() => {
                    void refreshWalletBalance();
                    openWalletBalanceModal();
                  }}
                >
                  Balances
                </button>
              </div>
              {walletBalance.step === "loaded" && walletBalance.data.balances.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-[var(--cream-dim)]">
                  {walletBalance.data.balances.slice(0, 6).map((b) => (
                    <li key={`${b.chain ?? "stellar"}-${b.code}-${b.issuer ?? "native"}`}>
                      {b.code}: {b.balance ?? "—"}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <button type="button" className="btn btn-primary self-start" onClick={() => openLoginModal()}>
              Create / open Pollar account
            </button>
          )}
        </section>

        <section className="panel flex flex-col gap-4 p-5">
          <div>
            <h2 className="display text-xl tracking-tight">2 · KYC</h2>
            <p className="mt-1 text-sm text-[var(--cream-dim)]">
              Sandbox / SEP-24 providers ask for identity before bank payout. Complete
              it once; the ramp modal will also prompt if a corridor still needs it.
            </p>
          </div>
          <button type="button" className="btn btn-amber self-start" onClick={runKyc}>
            Pass KYC
          </button>
          <p className="text-xs text-[var(--cream-dim)]">
            In sandbox, verification is usually instant or uses test credentials from
            the provider card in the Pollar dashboard.
          </p>
        </section>
      </div>

      <section className="panel flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="display text-xl tracking-tight">3 · One-click cash out</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--cream-dim)]">
              Opens Pollar&apos;s ramp widget: pick <strong>Sell / offramp</strong>, amount,
              bank / CBU fields the corridor requires, then authorize. Pollar settles the
              token leg and pays the sandbox bank account.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost !py-1.5 !px-3 text-sm" onClick={() => onRefreshRoutes()}>
              Refresh corridors
            </button>
            <button type="button" className="btn btn-primary" onClick={runOfframp} disabled={!routesReady && isAuthenticated}>
              Cash out to bank
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {routes == null ? (
            <span className="pill">Checking corridors…</span>
          ) : routes.ok && routeCount > 0 ? (
            <span className="pill pill-ok">{routeCount} offramp corridor(s) live</span>
          ) : (
            <span className="pill pill-danger">No offramp corridors enabled</span>
          )}
          {routes?.error ? (
            <span className="text-[var(--danger)]">{routes.error}</span>
          ) : null}
        </div>

        {!routesReady && (
          <div className="rounded-xl border border-[var(--amber)]/40 bg-[rgba(224,164,90,0.08)] p-4 text-sm">
            <p className="font-medium text-[var(--amber)]">Enable a TestNet sell provider</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--cream-dim)]">
              <li>
                Open{" "}
                <a className="text-[var(--mint)] underline" href="https://dashboard.pollar.xyz" target="_blank" rel="noreferrer">
                  dashboard.pollar.xyz
                </a>{" "}
                → app <strong>Veilpay</strong> (TestNet)
              </li>
              <li>
                <strong>Ramps → Providers</strong> — turn on <strong>Anclap</strong> (SEP-24 hosted)
                and/or any Sandbox provider shown for TestNet
              </li>
              <li>Enable at least one <strong>Sell</strong> corridor (ARS / PEN / local fiat)</li>
              <li>
                <strong>Build → Allowed origins</strong> — add{" "}
                <code>https://veilpay-henna.vercel.app</code> and{" "}
                <code>http://localhost:3000</code>
              </li>
              <li>Return here and click Refresh corridors, then Cash out</li>
            </ol>
          </div>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="display text-xl tracking-tight">Confidential → bank path</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--cream-dim)]">
          <li>
            On{" "}
            <Link href="/app/confidential" className="text-[var(--mint)] underline">
              Confidential
            </Link>
            , unlock and <strong>withdraw</strong> to the Pollar receive address above
            (amount becomes public at the unwrap boundary).
          </li>
          <li>Confirm the balance under Pollar Balances.</li>
          <li>Pass KYC if prompted, then Cash out — enter bank details in the Pollar modal.</li>
        </ol>
      </section>
    </div>
  );
}
