"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  connectFreighter,
  networkMismatch,
  restoreWallet,
  shortenAddress,
  walletStateEqual,
  type WalletState,
} from "@/lib/stellar/wallet";

type WalletContextValue = {
  address: string | null;
  network: string | null;
  installed: boolean;
  connecting: boolean;
  mismatch: boolean;
  short: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const POLL_MS = 1000;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    network: null,
    networkPassphrase: null,
    installed: false,
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const disconnectedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyWallet = useCallback((next: WalletState) => {
    if (disconnectedRef.current && next.address) {
      // User clicked Disconnect — don't auto-restore until they Connect again.
      return;
    }
    setState((prev) => (walletStateEqual(prev, next) ? prev : next));
  }, []);

  const refresh = useCallback(async () => {
    const next = await restoreWallet();
    if (next.address) disconnectedRef.current = false;
    applyWallet(next);
  }, [applyWallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll Freighter + re-check on focus/visibility (WatchWalletChanges alone is flaky).
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled || disconnectedRef.current) return;
      try {
        const next = await restoreWallet();
        if (!cancelled) applyWallet(next);
      } catch {
        /* ignore transient extension errors */
      }
    };

    const id = window.setInterval(() => void tick(), POLL_MS);
    const onFocus = () => void tick();
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [applyWallet]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      disconnectedRef.current = false;
      const next = await connectFreighter();
      applyWallet(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [applyWallet]);

  const disconnect = useCallback(() => {
    disconnectedRef.current = true;
    setState((s) => ({ ...s, address: null, network: null, networkPassphrase: null }));
    setError(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      address: state.address,
      network: state.network,
      installed: state.installed,
      connecting,
      mismatch: networkMismatch(state.networkPassphrase),
      short: state.address ? shortenAddress(state.address) : null,
      error,
      connect,
      disconnect,
      refresh,
    }),
    [state, connecting, error, connect, disconnect, refresh],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
