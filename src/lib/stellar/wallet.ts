/**
 * Freighter wallet helpers (browser-only).
 * Docs: https://docs.freighter.app/extension-freighter-api/connecting
 */

import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import { currentNetwork, networkMode } from "./config";

export type WalletState = {
  address: string | null;
  network: string | null;
  networkPassphrase: string | null;
  installed: boolean;
};

const empty = (installed: boolean): WalletState => ({
  address: null,
  network: null,
  networkPassphrase: null,
  installed,
});

export function shortenAddress(addr: string, chars = 4) {
  if (addr.length < chars * 2 + 3) return addr;
  return `${addr.slice(0, chars + 1)}…${addr.slice(-chars)}`;
}

export async function detectFreighter(): Promise<boolean> {
  try {
    const { isConnected: ok, error } = await isConnected();
    if (error) return false;
    return Boolean(ok);
  } catch {
    return false;
  }
}

async function readNetwork(): Promise<{ network: string | null; networkPassphrase: string | null }> {
  try {
    const net = await getNetworkDetails();
    if (net.error) return { network: null, networkPassphrase: null };
    return {
      network: net.network ?? null,
      networkPassphrase: net.networkPassphrase ?? null,
    };
  } catch {
    return { network: null, networkPassphrase: null };
  }
}

/** Silent restore — no popup if already allowed. */
export async function restoreWallet(): Promise<WalletState> {
  const installed = await detectFreighter();
  if (!installed) return empty(false);
  try {
    const { address, error } = await getAddress();
    if (error || !address) return empty(true);
    const net = await readNetwork();
    return { address, installed: true, ...net };
  } catch {
    return empty(true);
  }
}

/** Connect with Freighter popup (requestAccess). */
export async function connectFreighter(): Promise<WalletState> {
  const installed = await detectFreighter();
  if (!installed) {
    throw new Error("Freighter is not installed. Install from freighter.app");
  }
  const { address, error } = await requestAccess();
  if (error || !address) {
    throw new Error(error?.message ?? "Freighter access denied");
  }
  const net = await readNetwork();
  return { address, installed: true, ...net };
}

export function expectedPassphrase() {
  return currentNetwork().networkPassphrase;
}

export function networkMismatch(walletPassphrase: string | null) {
  if (!walletPassphrase) return false;
  return walletPassphrase !== expectedPassphrase();
}

export async function signXdr(xdr: string, address: string) {
  const net = currentNetwork();
  const result = await signTransaction(xdr, {
    networkPassphrase: net.networkPassphrase,
    address,
  });
  if (result.error) throw new Error(result.error.message);
  return result.signedTxXdr;
}

export function walletStateEqual(a: WalletState, b: WalletState): boolean {
  return (
    a.address === b.address &&
    a.network === b.network &&
    a.networkPassphrase === b.networkPassphrase &&
    a.installed === b.installed
  );
}

export { networkMode };
