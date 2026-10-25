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

const SPP_LOCK_CHANNEL = "veilpay-spp-lock";

let sharedBoot: Promise<SharedRuntime> | null = null;
let lockChannel: BroadcastChannel | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isSppLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /local database|Access Handle|OPFS|another tab|another window|NoModificationAllowed|database/i.test(
    msg,
  );
}

/** Ask other Veilpay tabs to drop their SPP OPFS handle. */
export function signalOtherTabsToReleaseSpp() {
  try {
    const bc = new BroadcastChannel(SPP_LOCK_CHANNEL);
    bc.postMessage({ type: "release" });
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
      if (ev.data?.type === "release") {
        void releaseSppRuntime();
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

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      // One OPFS DB handle for the whole tab — a second Storage.open() panics.
      const storage = await spp.Storage.open({
        workerUrl: sppAssetUrls.storageWorkerUrl,
      });

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
    } catch (e) {
      lastErr = e;
      if (!isSppLockError(e) || attempt === 6) break;
      signalOtherTabsToReleaseSpp();
      await releaseSppRuntime();
      await sleep(500 * attempt);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(
        "Another tab is using Veilpay’s SPP database. Close other Veilpay / Private pay / Stealth tabs, wait 2s, then reload.",
      );
}

/** Shared Client + Storage for this tab (lazy). Failed boots are not cached. */
export function getSharedSppRuntime() {
  ensureLockListener();
  if (!sharedBoot) {
    sharedBoot = bootSharedRuntime().catch((e) => {
      sharedBoot = null;
      throw e;
    });
  }
  return sharedBoot;
}

/**
 * Fully stop background sync + dispose the WASM client and wait for the
 * OPFS sync access handle to release. Safe to call when boot never succeeded.
 */
export async function releaseSppRuntime(): Promise<void> {
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
    try {
      rt.client.dispose?.();
    } catch {
      /* ignore */
    }
  } catch {
    /* previous boot failed — nothing to dispose */
  }
  await sleep(900);
}

/** @deprecated use releaseSppRuntime — kept for call sites that fire-and-forget */
export function resetSharedSppRuntime() {
  void releaseSppRuntime();
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
 */
export async function wipeSppLocalWallet(): Promise<void> {
  signalOtherTabsToReleaseSpp();
  await sleep(300);
  await releaseSppRuntime();

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
    /* OPFS unavailable */
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

  // Extra settle time so the next Storage.open() does not race a dying worker.
  await sleep(700);
}

export async function createSppClient(opts?: {
  poolContract?: string;
  bootnodeUrl?: string;
  userAddress?: string;
  /** Defaults to Freighter. Pass a stealth KeypairSigner to shield burner funds. */
  signer?: import("stellar-private-payments").WalletSigner;
}) {
  const { FreighterSigner } = await import("stellar-private-payments/freighter");

  let client: SharedRuntime["client"];
  let networkPassphrase: string;
  let rpcUrl: string;
  try {
    ({ client, networkPassphrase, rpcUrl } = await getSharedSppRuntime());
  } catch (e) {
    if (isSppLockError(e)) {
      signalOtherTabsToReleaseSpp();
      await releaseSppRuntime();
      await sleep(1000);
      ({ client, networkPassphrase, rpcUrl } = await getSharedSppRuntime());
    } else {
      throw e;
    }
  }

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
