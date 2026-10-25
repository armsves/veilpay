/**
 * GH Pages SPP SDK (circuits v0.7) requires Storage.open({ keyProvider }).
 * Mirrors Nethermind demo unlock: Freighter-sign → HKDF → AES-GCM wrapped DB key.
 */

"use client";

import { Keypair } from "@stellar/stellar-sdk";
import { sppAssetUrls } from "./config";

const META_KEY = "poolstellar_encrypted_storage_v1";
const HKDF_INFO = "spp.browser.storage-key-wrap.v1";

type StorageMeta = {
  version: 1;
  address: string;
  origin: string;
  salt: string;
  pending?: boolean;
  iv?: string;
  envelope?: string;
  directory?: string;
};

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function decodeSignature(signedMessage: string): Uint8Array {
  try {
    const raw = b64Decode(signedMessage);
    if (raw.length === 64) return raw;
  } catch {
    /* fall through */
  }
  const hex = signedMessage.replace(/^0x/, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length === 128) {
    const out = new Uint8Array(64);
    for (let i = 0; i < 64; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  throw new Error("Unexpected Freighter signature encoding for storage unlock");
}

/** Freighter signMessage is SEP-53 — must use verifyMessage, not raw verify. */
function verifyWalletSig(address: string, message: string, sig: Uint8Array): boolean {
  try {
    return Keypair.fromPublicKey(address).verifyMessage(message, Buffer.from(sig));
  } catch {
    return false;
  }
}

async function hasOpfsDatabase(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name] of (root as any).entries() as AsyncIterable<[string, unknown]>) {
      if (/spp|sqlite|\.db|stellar/i.test(name)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Open SPP OPFS storage with Freighter-gated encryption key (v0.7 SDK).
 */
export async function openEncryptedSppStorage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Storage: { open: (opts: Record<string, unknown>) => Promise<any> },
  freighterAddress: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { FreighterSigner } = await import("stellar-private-payments/freighter");
  const signer = new FreighterSigner();
  const cryptoApi = globalThis.crypto;
  const origin = location.origin;
  const textEnc = new TextEncoder();

  let parsed: StorageMeta | null = null;
  try {
    const raw = localStorage.getItem(META_KEY);
    parsed = raw ? (JSON.parse(raw) as StorageMeta) : null;
  } catch (e) {
    throw new Error("Invalid SPP storage key metadata — use Reset SPP", { cause: e });
  }

  const fresh = !parsed;
  let meta: StorageMeta;
  if (fresh) {
    if (await hasOpfsDatabase()) {
      const err = new Error(
        "Encrypted local data exists but unlock metadata is missing — use Reset SPP",
      ) as Error & { code?: string };
      err.code = "storage-recovery-required";
      throw err;
    }
    meta = {
      version: 1,
      address: freighterAddress,
      origin,
      salt: b64Encode(cryptoApi.getRandomValues(new Uint8Array(32))),
      pending: true,
    };
  } else {
    meta = parsed!;
  }

  let valid = false;
  try {
    valid =
      meta.version === 1 &&
      meta.origin === origin &&
      typeof meta.address === "string" &&
      !!meta.address &&
      typeof meta.salt === "string" &&
      b64Decode(meta.salt).length === 32 &&
      (fresh ||
        (typeof meta.iv === "string" &&
          b64Decode(meta.iv).length === 12 &&
          typeof meta.envelope === "string" &&
          b64Decode(meta.envelope).length === 48));
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new Error("Invalid SPP storage key metadata — use Reset SPP");
  }

  if (fresh) meta.address = freighterAddress;
  if (meta.address !== freighterAddress) {
    throw new Error(
      `SPP storage is locked to ${meta.address.slice(0, 6)}… — switch Freighter back or Reset SPP`,
    );
  }

  const unlockMsg = `Stellar Private Payments storage unlock v1\nOrigin: ${origin}\nAccount: ${meta.address}\nSalt: ${meta.salt}`;

  const signOnce = async () => {
    const result = await signer.signMessage(unlockMsg, { address: meta.address });
    const signedMessage = String(
      (result as { signedMessage?: unknown }).signedMessage ?? result,
    );
    const signerAddress = (result as { signerAddress?: string }).signerAddress;
    if (signerAddress && signerAddress !== meta.address) {
      throw new Error("Storage unlock signed with a different account");
    }
    const sig = decodeSignature(signedMessage);
    try {
      if (sig.length !== 64 || !verifyWalletSig(meta.address, unlockMsg, sig)) {
        throw new Error("Invalid wallet signature for storage unlock");
      }
      return sig;
    } catch (e) {
      sig.fill(0);
      throw e;
    }
  };

  const sig1 = await signOnce();
  let dbKey: Uint8Array | undefined;
  try {
    if (fresh) {
      const sig2 = await signOnce();
      const same = sig2.every((b, i) => b === sig1[i]);
      sig2.fill(0);
      if (!same) throw new Error("Wallet signatures must be reproducible to unlock storage");
    }

    const hkdfKey = await cryptoApi.subtle.importKey(
      "raw",
      asBufferSource(sig1),
      "HKDF",
      false,
      ["deriveKey"],
    );
    const wrapKey = await cryptoApi.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: asBufferSource(b64Decode(meta.salt)),
        info: textEnc.encode(HKDF_INFO),
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const aad = textEnc.encode(unlockMsg);

    if (fresh) {
      dbKey = cryptoApi.getRandomValues(new Uint8Array(32));
      const iv = cryptoApi.getRandomValues(new Uint8Array(12));
      meta.iv = b64Encode(iv);
      meta.envelope = b64Encode(
        new Uint8Array(
          await cryptoApi.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData: aad },
            wrapKey,
            asBufferSource(dbKey),
          ),
        ),
      );
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } else {
      dbKey = new Uint8Array(
        await cryptoApi.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: asBufferSource(b64Decode(meta.iv!)),
            additionalData: aad,
          },
          wrapKey,
          asBufferSource(b64Decode(meta.envelope!)),
        ),
      );
    }

    if (dbKey.length !== 32) throw new Error("Invalid database key envelope");

    const keyForProvider = new Uint8Array(dbKey);
    const open = (createNew: boolean) =>
      Storage.open({
        workerUrl: sppAssetUrls.storageWorkerUrl,
        keyProvider: async () => keyForProvider,
        createNew,
        directory: meta.directory,
      });

    let storage;
    try {
      storage = await open(meta.pending === true);
    } catch (e) {
      if (
        meta.pending &&
        String(e).includes("database create/open purpose does not match existing file")
      ) {
        storage = await open(false);
      } else {
        throw e;
      }
    }

    meta.pending = false;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    return storage;
  } finally {
    sig1.fill(0);
    dbKey?.fill(0);
  }
}

export function clearSppStorageUnlockMeta() {
  try {
    localStorage.removeItem(META_KEY);
  } catch {
    /* ignore */
  }
}
