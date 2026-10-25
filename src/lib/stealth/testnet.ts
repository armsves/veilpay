/**
 * Veilpay Stealth — TESTNET path
 * Uses Stellar privacy primitives documented at:
 * https://developers.stellar.org/docs/build/apps/privacy
 *
 * Integrates with Nethermind Stellar Private Payments (SPP) patterns +
 * dual-key stealth (DKSAP-style) for one-time receive addresses on testnet.
 * Production wiring: `stellar-private-payments` npm + deployed SPP contracts.
 */

import nacl from "tweetnacl";
import { decodeUTF8, encodeBase64, decodeBase64 } from "tweetnacl-util";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

export type StealthMetaAddress = {
  version: 1;
  network: "testnet";
  spendingPubKey: string; // base64 ed25519
  viewingPubKey: string;
  encoded: string; // veil:testnet:...
};

export type StealthPayment = {
  stealthAddress: string; // G...
  ephemeralPubKey: string;
  viewTag: number;
  memoHint: string;
};

function sha256(bytes: Uint8Array): Uint8Array {
  // Lightweight hash via nacl hash (SHA-512) truncated — demo-grade.
  // Swap for blake3 / proper HKDF when wiring SPP WASM scanner.
  return nacl.hash(bytes).slice(0, 32);
}

function toHex(b: Uint8Array) {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

/** Derive spending + viewing keypair from a wallet signature payload. */
export function deriveStealthKeysFromSeed(seed: Uint8Array): {
  spending: nacl.SignKeyPair;
  viewing: nacl.BoxKeyPair;
} {
  const spendingSeed = sha256(new Uint8Array([...seed, ...decodeUTF8("veilpay-spend-v1")]));
  const viewingSeed = sha256(new Uint8Array([...seed, ...decodeUTF8("veilpay-view-v1")]));
  return {
    spending: nacl.sign.keyPair.fromSeed(spendingSeed),
    viewing: nacl.box.keyPair.fromSecretKey(viewingSeed),
  };
}

export function encodeMetaAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): StealthMetaAddress {
  const spending = encodeBase64(spendingPubKey);
  const viewing = encodeBase64(viewingPubKey);
  const encoded = `veil:testnet:${spending}.${viewing}`;
  return {
    version: 1,
    network: "testnet",
    spendingPubKey: spending,
    viewingPubKey: viewing,
    encoded,
  };
}

export function decodeMetaAddress(encoded: string): StealthMetaAddress {
  if (!encoded.startsWith("veil:testnet:")) {
    throw new Error("Expected veil:testnet: meta-address");
  }
  const body = encoded.slice("veil:testnet:".length);
  const [spending, viewing] = body.split(".");
  if (!spending || !viewing) throw new Error("Malformed meta-address");
  return {
    version: 1,
    network: "testnet",
    spendingPubKey: spending,
    viewingPubKey: viewing,
    encoded,
  };
}

/**
 * Index-based one-time address (Veilpay VNS).
 * Owner can always re-derive address #i from their viewing key — no ephemeral
 * announcement store required (critical on serverless where memory is wiped).
 */
export function stealthKeypairAtIndex(viewingSecretKey: Uint8Array, index: number) {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error("stealth index must be a positive integer");
  }
  const digest = sha256(
    new Uint8Array([...viewingSecretKey, ...decodeUTF8(`veil-idx:${index}`)]),
  );
  const stealthSeed = sha256(new Uint8Array([...digest, ...decodeUTF8("stealth-addr")]));
  const kp = Keypair.fromRawEd25519Seed(Buffer.from(stealthSeed));
  return { kp, digest, viewTag: digest[0]!, index };
}

/** Sender/resolve: one-time address for payment index. */
export function generateIndexedStealthPayment(
  viewingSecretKey: Uint8Array,
  index: number,
): StealthPayment & { index: number } {
  const { kp, digest, viewTag } = stealthKeypairAtIndex(viewingSecretKey, index);
  return {
    stealthAddress: kp.publicKey(),
    /** Indexed mode: embed index so memos / clients can recover without server state. */
    ephemeralPubKey: `idx:${index}`,
    viewTag,
    memoHint: `vp-i${index}-${viewTag.toString(16).padStart(2, "0")}-${toHex(digest.slice(0, 3))}`,
    index,
  };
}

/** @deprecated Random-ECDH path — kept for old announcement sweeps only. */
export function generateStealthPayment(meta: StealthMetaAddress): StealthPayment {
  const ephemeral = nacl.box.keyPair();
  const viewPub = decodeBase64(meta.viewingPubKey);
  const shared = nacl.scalarMult(ephemeral.secretKey, viewPub);
  const digest = sha256(shared);
  const viewTag = digest[0]!;
  const stealthSeed = sha256(new Uint8Array([...digest, ...decodeUTF8("stealth-addr")]));
  const kp = Keypair.fromRawEd25519Seed(Buffer.from(stealthSeed));
  return {
    stealthAddress: kp.publicKey(),
    ephemeralPubKey: encodeBase64(ephemeral.publicKey),
    viewTag,
    memoHint: `vp-${viewTag.toString(16).padStart(2, "0")}-${toHex(digest.slice(0, 4))}`,
  };
}

function stealthKeypairFromShared(viewingSecretKey: Uint8Array, ephemeralPubKeyB64: string) {
  if (ephemeralPubKeyB64.startsWith("idx:")) {
    const index = Number(ephemeralPubKeyB64.slice(4));
    return stealthKeypairAtIndex(viewingSecretKey, index);
  }
  const eph = decodeBase64(ephemeralPubKeyB64);
  const shared = nacl.scalarMult(viewingSecretKey, eph);
  const digest = sha256(shared);
  const stealthSeed = sha256(new Uint8Array([...digest, ...decodeUTF8("stealth-addr")]));
  const kp = Keypair.fromRawEd25519Seed(Buffer.from(stealthSeed));
  return { kp, digest, viewTag: digest[0]! };
}

/** Recipient: check if an announcement belongs to us via view tag + ECDH. */
export function matchesAnnouncement(
  viewingSecretKey: Uint8Array,
  ephemeralPubKeyB64: string,
  viewTag: number,
  spendingPubKeyB64: string,
): { match: boolean; stealthAddress?: string } {
  const { kp, viewTag: tag } = stealthKeypairFromShared(viewingSecretKey, ephemeralPubKeyB64);
  if (tag !== viewTag) return { match: false };
  void spendingPubKeyB64;
  return { match: true, stealthAddress: kp.publicKey() };
}

/**
 * Sweep key for a stealth receive the owner scanned.
 * Same ECDH the sender used → recompute one-time keypair → move funds to Freighter.
 */
export function deriveStealthSweepKey(
  viewingSecretKey: Uint8Array,
  ephemeralPubKeyB64: string,
  expectedAddress?: string,
): { address: string; secret: string; keypair: Keypair } {
  const { kp } = stealthKeypairFromShared(viewingSecretKey, ephemeralPubKeyB64);
  if (expectedAddress && kp.publicKey() !== expectedAddress) {
    throw new Error("Stealth address mismatch — wrong ephemeral or viewing key");
  }
  return { address: kp.publicKey(), secret: kp.secret(), keypair: kp };
}

export function isValidStellarAddress(addr: string) {
  try {
    return StrKey.isValidEd25519PublicKey(addr);
  } catch {
    return false;
  }
}

export const testnetStealthInfo = {
  id: "stealth-testnet",
  label: "Stealth (Stellar testnet)",
  stack: "DKSAP-style + SPP-compatible announcements",
  docs: "https://developers.stellar.org/docs/build/apps/privacy",
  spp: "https://github.com/NethermindEth/stellar-private-payments",
} as const;
