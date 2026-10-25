"use client";

import { useWallet } from "./WalletProvider";

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, short, connecting, mismatch, installed, error, connect, disconnect } =
    useWallet();

  if (address) {
    return (
      <div className="flex items-center gap-2">
        {mismatch && (
          <span className="pill pill-danger" title="Switch Freighter to Testnet">
            Wrong network
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost text-sm !py-1.5 !px-3"
          onClick={disconnect}
          title={address}
        >
          {short}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn btn-primary text-sm !py-1.5 !px-3"
        disabled={connecting}
        onClick={() => void connect()}
      >
        {connecting ? "Connecting…" : compact ? "Connect" : "Connect Freighter"}
      </button>
      {!installed && !compact && (
        <a
          className="text-[10px] text-[var(--cream-dim)] underline"
          href="https://freighter.app"
          target="_blank"
          rel="noreferrer"
        >
          Install Freighter
        </a>
      )}
      {error && <span className="max-w-[180px] text-[10px] text-[var(--danger)]">{error}</span>}
    </div>
  );
}
