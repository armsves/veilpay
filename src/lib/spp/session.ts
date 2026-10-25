/**
 * Browser-only Stellar Private Payments session.
 * Deposit / private transfer / withdraw against Nethermind testnet pools.
 *
 * OPFS allows only one sync access handle — open Storage once per page and
 * reuse the Client shell for every account (Freighter + stealth burners).
 */

"use client";

import { sppAssetUrls, SPP_DEFAULT_BOOTNODE_URL, SPP_XLM_POOL_ID } from "./config";

export type SppSession = {
  // Client/account/pool come from the WASM SDK; keep loose to avoid circular typings.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  account: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any;
  poolContract: string;
  networkPassphrase: string;
};

type SharedRuntime = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  networkPassphrase: string;
  rpcUrl: string;
};

let sharedBoot: Promise<SharedRuntime> | null = null;

async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function bootSharedRuntime(): Promise<SharedRuntime> {
  const spp = await import("stellar-private-payments");
  await spp.default();

  const contractConfig = await loadJson<Record<string, unknown>>(sppAssetUrls.deploymentsUrl);
  const circuitLock = await loadJson<Record<string, unknown>>(sppAssetUrls.circuitsLockUrl);

  const rpcUrl =
    (typeof contractConfig.rpcUrl === "string" && contractConfig.rpcUrl) ||
    "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    (typeof contractConfig.networkPassphrase === "string" && contractConfig.networkPassphrase) ||
    "Test SDF Network ; September 2015";

  // One OPFS DB handle for the whole tab — a second Storage.open() panics.
  const storage = await spp.Storage.open({
    workerUrl: sppAssetUrls.storageWorkerUrl,
  });

  const bootnodeUrl =
    process.env.NEXT_PUBLIC_SPP_BOOTNODE_URL?.trim() || SPP_DEFAULT_BOOTNODE_URL;

  const client = await spp.Client.new({
    rpcUrl,
    storage,
    contractConfig: contractConfig as never,
    circuitsBaseUrl: sppAssetUrls.circuitsBaseUrl,
    circuitLock: circuitLock as never,
    storageWorkerUrl: sppAssetUrls.storageWorkerUrl,
    proverWorkerUrl: sppAssetUrls.proverWorkerUrl,
    bootnodeUrl,
  });

  await client.backgroundSync();
  return { client, networkPassphrase, rpcUrl };
}

/** Shared Client + Storage for this tab (lazy). */
export function getSharedSppRuntime() {
  if (!sharedBoot) sharedBoot = bootSharedRuntime();
  return sharedBoot;
}

/** Drop the shared runtime so the next call re-opens OPFS (e.g. after fatal storage errors). */
export function resetSharedSppRuntime() {
  void sharedBoot
    ?.then((rt) => {
      try {
        rt.client.stopBackgroundSync?.();
      } catch {
        /* ignore */
      }
      try {
        rt.client.dispose?.();
      } catch {
        /* ignore */
      }
    })
    .catch(() => undefined);
  sharedBoot = null;
}

/** Normalize 0x-hex for SPP key comparisons. */
export function normSppHex(hex: string): string {
  return hex.trim().toLowerCase().replace(/^0x/, "");
}

export function sppKeysMatch(
  a: { notePublicKey?: string; encryptionPublicKey?: string; noteKey?: string; encryptionKey?: string },
  b: { notePublicKey?: string; encryptionPublicKey?: string; noteKey?: string; encryptionKey?: string },
): boolean {
  const noteA = a.notePublicKey ?? a.noteKey ?? "";
  const noteB = b.notePublicKey ?? b.noteKey ?? "";
  const encA = a.encryptionPublicKey ?? a.encryptionKey ?? "";
  const encB = b.encryptionPublicKey ?? b.encryptionKey ?? "";
  return normSppHex(noteA) === normSppHex(noteB) && normSppHex(encA) === normSppHex(encB);
}

/**
 * Tear down the WASM client and delete SPP OPFS / localStorage so the next
 * `createSppClient` re-derives Freighter privacy keys from scratch.
 * Privacy keys are deterministic (SEP-53 sign of the v2 KDF message) — a clean
 * re-derive should match the on-chain registry when it was registered the same way.
 */
export async function wipeSppLocalWallet(): Promise<void> {
  resetSharedSppRuntime();
  // Let dispose finish before removing OPFS files the worker may hold.
  await new Promise((r) => setTimeout(r, 200));

  try {
    const root = await navigator.storage.getDirectory();
    const toRemove: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name] of (root as any).entries() as AsyncIterable<[string, unknown]>) {
      if (/spp|sqlite|opfs|sahpool/i.test(name)) toRemove.push(name);
    }
    for (const name of toRemove) {
      try {
        await root.removeEntry(name, { recursive: true });
      } catch {
        /* ignore locked / missing */
      }
    }
  } catch {
    /* OPFS unavailable */
  }

  try {
    const kill: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /spp|stellar-private|privacy.?pool/i.test(k)) kill.push(k);
    }
    for (const k of kill) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export async function createSppClient(opts?: {
  poolContract?: string;
  bootnodeUrl?: string;
  userAddress?: string;
  /** Defaults to Freighter. Pass a stealth KeypairSigner to shield burner funds. */
  signer?: import("stellar-private-payments").WalletSigner;
}) {
  const { FreighterSigner } = await import("stellar-private-payments/freighter");
  const { client, networkPassphrase, rpcUrl } = await getSharedSppRuntime();

  const signer = opts?.signer ?? new FreighterSigner();
  const account = await client.account(
    {
      networkPassphrase,
      userAddress: opts?.userAddress,
    },
    signer,
  );

  await account.derivePrivacyKeys();
  try {
    await account.registerPublicKeys();
  } catch {
    // Already registered is fine
  }

  const poolContract = opts?.poolContract ?? SPP_XLM_POOL_ID;
  const pool = await account.pool({ poolContract });

  return { client, account, pool, poolContract, networkPassphrase, rpcUrl };
}

export function xlmToStroops(amount: string): bigint {
  const [w, f = ""] = amount.trim().split(".");
  const frac = (f + "0000000").slice(0, 7);
  return BigInt(w || "0") * 10_000_000n + BigInt(frac || "0");
}

export function stroopsToXlm(stroops: bigint): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const whole = v / 10_000_000n;
  const frac = (v % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
