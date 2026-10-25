/**
 * Browser-only Stellar Private Payments session.
 * Deposit / private transfer / withdraw against Nethermind testnet pools.
 *
 * OPFS allows only one sync access handle per origin. Re-opening Storage in the
 * same page after dispose races the dying worker (NoModificationAllowedError /
 * “another tab”) and Client.dispose() can throw “null pointer passed to rust”.
 * Recovery path: stop sync → wipe → full page reload (never Storage.open twice
 * in one document lifetime after a failed/closed client).
 */

"use client";

import { sppAssetUrls, SPP_DEFAULT_BOOTNODE_URL, SPP_XLM_POOL_ID } from "./config";

export type SppSession = {
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

const SPP_LOCK_CHANNEL = "veilpay-spp-lock";
/** After wipe, reload then auto-connect. */
export const SPP_AFTER_WIPE_KEY = "veilpay-spp-after-wipe";

let sharedBoot: Promise<SharedRuntime> | null = null;
let lockChannel: BroadcastChannel | null = null;
/** True once this document successfully opened Storage — do not open again here. */
let storageOpenedInThisDocument = false;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isSppLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /local database|Access Handle|OPFS|another tab|another window|NoModificationAllowed|null pointer/i.test(
    msg,
  );
}

/** Ask other Veilpay tabs to reload so they drop their OPFS Access Handle. */
export function signalOtherTabsToReleaseSpp() {
  try {
    const bc = new BroadcastChannel(SPP_LOCK_CHANNEL);
    bc.postMessage({ type: "reload" });
    bc.close();
  } catch {
    /* BroadcastChannel unavailable */
  }
}

function ensureLockListener() {
  if (typeof window === "undefined" || lockChannel) return;
  try {
    lockChannel = new BroadcastChannel(SPP_LOCK_CHANNEL);
    lockChannel.onmessage = (ev) => {
      if (ev.data?.type === "reload" || ev.data?.type === "release") {
        void softReleaseSppRuntime().finally(() => {
          // Full navigation is the only reliable way to drop CreateSyncAccessHandle.
          window.location.reload();
        });
      }
    };
  } catch {
    /* ignore */
  }
}

async function loadJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function bootSharedRuntime(): Promise<SharedRuntime> {
  ensureLockListener();

  if (storageOpenedInThisDocument) {
    throw new Error(
      "SPP storage was already opened in this tab. Reload the page to reconnect (OPFS allows only one Access Handle).",
    );
  }

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

  const bootnodeUrl =
    process.env.NEXT_PUBLIC_SPP_BOOTNODE_URL?.trim() || SPP_DEFAULT_BOOTNODE_URL;

  signalOtherTabsToReleaseSpp();
  await sleep(400);

  const storage = await spp.Storage.open({
    workerUrl: sppAssetUrls.storageWorkerUrl,
  });
  storageOpenedInThisDocument = true;

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

/** Shared Client + Storage for this tab (lazy). Failed boots are not cached. */
export function getSharedSppRuntime() {
  ensureLockListener();
  if (!sharedBoot) {
    sharedBoot = bootSharedRuntime().catch((e) => {
      sharedBoot = null;
      // Allow a reload-based retry; keep storageOpenedInThisDocument if open() succeeded then Client.new failed.
      throw e;
    });
  }
  return sharedBoot;
}

/**
 * Stop indexer only — do NOT call client.dispose()/free().
 * Dispose races the storage worker and throws “null pointer passed to rust”
 * while leaving the OPFS Access Handle held until the document unloads.
 */
export async function softReleaseSppRuntime(): Promise<void> {
  const pending = sharedBoot;
  sharedBoot = null;
  if (!pending) return;
  try {
    const rt = await pending;
    try {
      rt.client.stopBackgroundSync?.();
    } catch {
      /* ignore */
    }
  } catch {
    /* previous boot failed */
  }
  await sleep(200);
}

/** @deprecated prefer softReleaseSppRuntime + reload */
export async function releaseSppRuntime(): Promise<void> {
  await softReleaseSppRuntime();
}

export function resetSharedSppRuntime() {
  void softReleaseSppRuntime();
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
 * Stop sync, wipe OPFS, then the caller must reload the page before createSppClient.
 */
export async function wipeSppLocalWallet(): Promise<void> {
  signalOtherTabsToReleaseSpp();
  await sleep(500);
  await softReleaseSppRuntime();
  await sleep(500);

  try {
    const root = await navigator.storage.getDirectory();
    const toRemove: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name] of (root as any).entries() as AsyncIterable<[string, unknown]>) {
      toRemove.push(name);
    }
    for (const name of toRemove) {
      for (let tryN = 0; tryN < 3; tryN++) {
        try {
          await root.removeEntry(name, { recursive: true });
          break;
        } catch {
          await sleep(400 * (tryN + 1));
        }
      }
    }
  } catch {
    /* OPFS unavailable / still locked until reload */
  }

  try {
    const idb = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    if (typeof idb.databases === "function") {
      const dbs = await idb.databases();
      for (const db of dbs) {
        if (db.name && /spp|sqlite|opfs|stellar/i.test(db.name)) {
          indexedDB.deleteDatabase(db.name);
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const kill: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /spp|stellar-private|privacy.?pool|opfs/i.test(k)) kill.push(k);
    }
    for (const k of kill) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Wipe + flag + reload — only safe way to re-open SPP storage in this origin. */
export async function wipeSppLocalWalletAndReload(): Promise<void> {
  await wipeSppLocalWallet();
  try {
    sessionStorage.setItem(SPP_AFTER_WIPE_KEY, "1");
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function consumeSppAfterWipeFlag(): boolean {
  try {
    if (sessionStorage.getItem(SPP_AFTER_WIPE_KEY) === "1") {
      sessionStorage.removeItem(SPP_AFTER_WIPE_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
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
