/**
 * Browser-only Stellar Private Payments session.
 * Deposit / private transfer / withdraw against Nethermind testnet pools.
 *
 * OPFS allows one sync Access Handle per origin. Never wipe OPFS while a
 * storage worker holds it — set a pending flag, reload, then wipe *before*
 * Storage.open on the fresh document.
 */

"use client";

import { sppAssetUrls, SPP_DEFAULT_BOOTNODE_URL, SPP_XLM_POOL_ID } from "./config";
import {
  clearSppStorageUnlockMeta,
  openEncryptedSppStorage,
} from "./storage-unlock";

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
/** After wipe+reload, Private pay auto-connects. */
export const SPP_AFTER_WIPE_KEY = "veilpay-spp-after-wipe";
/** Wipe OPFS on next boot *before* Storage.open (handle must be gone). */
export const SPP_WIPE_PENDING_KEY = "veilpay-spp-wipe-pending";

let sharedBoot: Promise<SharedRuntime> | null = null;
let lockChannel: BroadcastChannel | null = null;
let storageOpenedInThisDocument = false;
const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isSppLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /local database|Access Handle|OPFS|another tab|another window|NoModificationAllowed|null pointer/i.test(
    msg,
  );
}

export function signalOtherTabsToReleaseSpp() {
  try {
    const bc = new BroadcastChannel(SPP_LOCK_CHANNEL);
    bc.postMessage({ type: "reload", from: TAB_ID });
    bc.close();
  } catch {
    /* ignore */
  }
}

function ensureLockListener() {
  if (typeof window === "undefined" || lockChannel) return;
  try {
    lockChannel = new BroadcastChannel(SPP_LOCK_CHANNEL);
    lockChannel.onmessage = (ev) => {
      const data = ev.data as { type?: string; from?: string } | null;
      if (!data || data.from === TAB_ID) return;
      if (data.type === "reload" || data.type === "release") {
        void softReleaseSppRuntime().finally(() => {
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

/** Delete OPFS / related storage. Must run with no live SPP Access Handle. */
async function clearSppBrowserStorage(): Promise<number> {
  let removed = 0;

  try {
    const root = await navigator.storage.getDirectory();
    const toRemove: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name] of (root as any).entries() as AsyncIterable<[string, unknown]>) {
      toRemove.push(name);
    }
    for (const name of toRemove) {
      try {
        await root.removeEntry(name, { recursive: true });
        removed += 1;
      } catch {
        await sleep(300);
        try {
          await root.removeEntry(name, { recursive: true });
          removed += 1;
        } catch {
          /* ignore */
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
          removed += 1;
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
      if (k && /spp|stellar-private|privacy.?pool|opfs|poolstellar/i.test(k)) kill.push(k);
    }
    for (const k of kill) {
      localStorage.removeItem(k);
      removed += 1;
    }
  } catch {
    /* ignore */
  }

  clearSppStorageUnlockMeta();

  return removed;
}

function consumeWipePendingFlag(): boolean {
  try {
    if (sessionStorage.getItem(SPP_WIPE_PENDING_KEY) === "1") {
      sessionStorage.removeItem(SPP_WIPE_PENDING_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function bootSharedRuntime(): Promise<SharedRuntime> {
  ensureLockListener();

  if (storageOpenedInThisDocument) {
    throw new Error(
      "SPP storage was already opened in this tab. Reload the page to reconnect (OPFS allows only one Access Handle).",
    );
  }

  // Fresh document after Reset: wipe while no worker holds the handle.
  if (consumeWipePendingFlag()) {
    const n = await clearSppBrowserStorage();
    console.info(`[veilpay-spp] wiped ${n} local storage entries before Storage.open`);
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

  // v0.7 SDK: OPFS DB is encrypted; Freighter must unlock (may prompt 1–2 signs).
  const { FreighterSigner } = await import("stellar-private-payments/freighter");
  const unlockAddress = await new FreighterSigner().getPublicKey();
  const storage = await openEncryptedSppStorage(spp.Storage, unlockAddress);
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

export async function releaseSppRuntime(): Promise<void> {
  await softReleaseSppRuntime();
}

export function resetSharedSppRuntime() {
  void softReleaseSppRuntime();
}

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
 * Schedule OPFS wipe on the *next* document load (no live Access Handle), then reload.
 */
export async function wipeSppLocalWalletAndReload(): Promise<void> {
  signalOtherTabsToReleaseSpp();
  await softReleaseSppRuntime();
  try {
    sessionStorage.setItem(SPP_WIPE_PENDING_KEY, "1");
    sessionStorage.setItem(SPP_AFTER_WIPE_KEY, "1");
  } catch {
    /* ignore */
  }
  // Give peer tabs a moment to start unloading before we navigate.
  await sleep(400);
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
  signerAddress?: string;
  signer?: import("stellar-private-payments").WalletSigner;
  /** Skip derive/register — use when note-owner keys already exist in OPFS. */
  skipKeySetup?: boolean;
}) {
  const { FreighterSigner } = await import("stellar-private-payments/freighter");
  const { client, networkPassphrase, rpcUrl } = await getSharedSppRuntime();

  const signer = opts?.signer ?? new FreighterSigner();
  const account = await client.account(
    {
      networkPassphrase,
      userAddress: opts?.userAddress,
      signerAddress: opts?.signerAddress,
    },
    signer,
  );

  if (!opts?.skipKeySetup) {
    await account.derivePrivacyKeys();
    try {
      await account.registerPublicKeys();
    } catch {
      // Already registered with different keys is fine for receive attempts
    }
  }

  const poolContract = opts?.poolContract ?? SPP_XLM_POOL_ID;
  const pool = await account.pool({ poolContract });

  return { client, account, pool, poolContract, networkPassphrase, rpcUrl };
}

/**
 * Derive + register SPP privacy keys and wait until recipientLookup sees them.
 * Used by Stealth name claim so payroll can transferToKeys this owner.
 */
export async function ensureSppKeysOnChain(
  address: string,
  opts?: { onProgress?: (msg: string) => void },
): Promise<SppSession> {
  const push = opts?.onProgress ?? (() => undefined);
  push("Deriving SPP privacy keys (Freighter may prompt)…");
  const s = await createSppClient({ userAddress: address });

  // createSppClient swallows register errors — retry and surface real failures.
  push("Publishing privacy keys on-chain…");
  try {
    const hash = await s.account.registerPublicKeys();
    if (hash) push(`Register submitted ${String(hash).slice(0, 12)}…`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already|registered|exist|duplicate/i.test(msg)) {
      if (/fund|balance|underfunded|insufficient|fee|trapped/i.test(msg)) {
        throw new Error(
          `SPP register needs testnet XLM for fees on this Freighter account. ${msg}`,
        );
      }
      if (/MismatchingParameterLen|UnexpectedSize|prepare register/i.test(msg)) {
        throw new Error(
          `SPP key register failed (stale local keys or old SDK). ` +
            `Use Reset SPP below / Private pay → Reset SPP wallet, reload, then Connect again. (${msg.slice(0, 100)})`,
        );
      }
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  for (let round = 1; round <= 8; round++) {
    push(`Syncing registry (${round}/8)…`);
    await s.client.sync();
    const lookup = await s.client.recipientLookup(address);
    if (lookup?.entry) {
      push("SPP keys visible on-chain");
      return s;
    }
    // Re-try register mid-loop once if still missing (tx may have been dropped).
    if (round === 3 || round === 6) {
      try {
        await s.account.registerPublicKeys();
      } catch {
        /* already registered or transient */
      }
    }
    await sleep(1000);
  }

  throw new Error(
    "SPP keys not on-chain yet — fund Freighter with a few testnet XLM, close other Veilpay tabs, then Connect SPP again",
  );
}

/**
 * Deposit into the pool so notes belong to `ownerAddress`, while `stealthSigner`
 * pays the Soroban tx / SAC from the stealth burner.
 *
 * Avoids deposit-as-stealth + private transfer (which stranded notes when
 * transfer targeted registry keys the Freighter wallet could not decrypt).
 */
export async function createOwnerNotesPaidByStealth(opts: {
  ownerAddress: string;
  stealthAddress: string;
  stealthSigner: import("stellar-private-payments").WalletSigner;
  poolContract?: string;
}) {
  // 1) Ensure Freighter-derived privacy keys exist for the note owner.
  await createSppClient({ userAddress: opts.ownerAddress });

  // 2) Same note owner, stealth as fee/SAC payer — do not re-derive (signer ≠ owner).
  return createSppClient({
    userAddress: opts.ownerAddress,
    signerAddress: opts.stealthAddress,
    signer: opts.stealthSigner,
    skipKeySetup: true,
    poolContract: opts.poolContract,
  });
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
