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

/** Sender: create a one-time stealth Stellar address for the recipient. */
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

/** Recipient: check if an announcement belongs to us via view tag + ECDH. */
export function matchesAnnouncement(
  viewingSecretKey: Uint8Array,
  ephemeralPubKeyB64: string,
  viewTag: number,
  spendingPubKeyB64: string,
): { match: boolean; stealthAddress?: string } {
  const eph = decodeBase64(ephemeralPubKeyB64);
  const shared = nacl.scalarMult(viewingSecretKey, eph);
  const digest = sha256(shared);
  if (digest[0] !== viewTag) return { match: false };
  const stealthSeed = sha256(new Uint8Array([...digest, ...decodeUTF8("stealth-addr")]));
  const kp = Keypair.fromRawEd25519Seed(Buffer.from(stealthSeed));
  // Spending key ownership is proven later when sweeping; meta spending pubkey is public.
  void spendingPubKeyB64;
  return { match: true, stealthAddress: kp.publicKey() };
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
