"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  connectFreighter,
  networkMismatch,
  restoreWallet,
  shortenAddress,
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

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    network: null,
    networkPassphrase: null,
    installed: false,
  });
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await restoreWallet();
    setState(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const next = await connectFreighter();
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
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
