/**
 * Veilpay Name Service (VNS) — Fluidkey-style human-readable stealth ids.
 *
 * Users register `name.veil`. Resolving returns a fresh one-time address
 * derived from owner viewing key + payment index (always re-derivable).
 */

import nacl from "tweetnacl";
import { decodeUTF8 } from "tweetnacl-util";
import {
  deriveStealthKeysFromSeed,
  deriveStealthSweepKey,
  encodeMetaAddress,
  generateIndexedStealthPayment,
  stealthKeypairAtIndex,
  type StealthMetaAddress,
  type StealthPayment,
} from "./testnet";
import {
  loadPersistedRegistry,
  savePersistedRegistry,
  type PersistedRegistry,
} from "./vns-persist";

export const VNS_TLD = "veil";

export type StealthAnnouncement = StealthPayment & {
  id: string;
  createdAt: number;
  swept: boolean;
  index: number;
};

export type VeilNameRecord = {
  name: string;
  fqdn: string;
  owner: string;
  meta: StealthMetaAddress;
  createdAt: number;
  resolveCount: number;
  inbox: StealthAnnouncement[];
};

const NAME_RE = /^[a-z0-9]([a-z0-9-]{1,14}[a-z0-9])?$/;

/** Unique payment index — must not depend on resettable resolveCount. */
function nextUniquePaymentIndex(): number {
  const ms = Date.now();
  const rand = Math.floor(Math.random() * 1024);
  return ms * 1024 + rand;
}

export function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\.veil$/i, "");
}

export function toFqdn(name: string): string {
  return `${normalizeName(name)}.${VNS_TLD}`;
}

export function validateName(input: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeName(input);
  if (name.length < 3) return { ok: false, error: "Name must be at least 3 characters" };
  if (name.length > 16) return { ok: false, error: "Name must be at most 16 characters" };
  if (!NAME_RE.test(name)) {
    return { ok: false, error: "Use lowercase letters, numbers, hyphens (no leading/trailing hyphen)" };
  }
  const reserved = new Set(["veil", "veilpay", "admin", "api", "www", "pay", "app", "null", "undefined"]);
  if (reserved.has(name)) return { ok: false, error: "That name is reserved" };
  return { ok: true, name };
}

export function seedFromOwner(owner: string): Uint8Array {
  const material = decodeUTF8(`veilpay-vns-v1:${owner}`);
  return nacl.hash(material).slice(0, 32);
}

export function metaForOwner(owner: string): StealthMetaAddress {
  const keys = deriveStealthKeysFromSeed(seedFromOwner(owner));
  return encodeMetaAddress(keys.spending.publicKey, keys.viewing.publicKey);
}

export function viewingSecretForOwner(owner: string): Uint8Array {
  return deriveStealthKeysFromSeed(seedFromOwner(owner)).viewing.secretKey;
}

class VeilNameRegistry {
  private byName = new Map<string, VeilNameRecord>();
  private byOwner = new Map<string, string>();
  private hydrated = false;

  private ensureHydrated() {
    if (this.hydrated) return;
    this.hydrated = true;
    const snap = loadPersistedRegistry();
    if (!snap) return;
    for (const r of snap.records) {
      try {
        const meta = metaForOwner(r.owner);
        const record: VeilNameRecord = {
          name: r.name,
          fqdn: r.fqdn,
          owner: r.owner,
          meta,
          createdAt: r.createdAt,
          resolveCount: r.resolveCount,
          inbox: r.inbox.map((a) => ({
            id: a.id,
            stealthAddress: a.stealthAddress,
            ephemeralPubKey: a.ephemeralPubKey,
            viewTag: a.viewTag,
            memoHint: a.memoHint,
            index: a.index ?? (Number(String(a.ephemeralPubKey).replace(/^idx:/, "")) || 0),
            createdAt: a.createdAt,
            swept: a.swept,
          })),
        };
        this.byName.set(r.name, record);
        this.byOwner.set(r.owner, r.name);
      } catch {
        /* skip bad row */
      }
    }
  }

  private persist() {
    const snap: PersistedRegistry = {
      version: 2,
      records: [...this.byName.values()].map((r) => ({
        name: r.name,
        fqdn: r.fqdn,
        owner: r.owner,
        metaEncoded: r.meta.encoded,
        createdAt: r.createdAt,
        resolveCount: r.resolveCount,
        inbox: r.inbox.map((a) => ({
          id: a.id,
          stealthAddress: a.stealthAddress,
          ephemeralPubKey: a.ephemeralPubKey,
          viewTag: a.viewTag,
          memoHint: a.memoHint,
          index: a.index,
          createdAt: a.createdAt,
          swept: a.swept,
        })),
      })),
    };
    savePersistedRegistry(snap);
  }

  list(): VeilNameRecord[] {
    this.ensureHydrated();
    return [...this.byName.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(nameOrFqdn: string): VeilNameRecord | null {
    this.ensureHydrated();
    const name = normalizeName(nameOrFqdn);
    return this.byName.get(name) ?? null;
  }

  getByOwner(owner: string): VeilNameRecord | null {
    this.ensureHydrated();
    const name = this.byOwner.get(owner);
    return name ? this.byName.get(name) ?? null : null;
  }

  available(nameOrFqdn: string): boolean {
    this.ensureHydrated();
    const v = validateName(nameOrFqdn);
    if (!v.ok) return false;
    return !this.byName.has(v.name);
  }

  register(opts: { name: string; owner: string }): VeilNameRecord {
    this.ensureHydrated();
    const v = validateName(opts.name);
    if (!v.ok) throw new Error(v.error);
    if (!opts.owner.startsWith("G") || opts.owner.length < 56) {
      throw new Error("Owner must be a Stellar G… address (connect Freighter)");
    }

    // Idempotent restore after serverless memory wipe / client rehydrate.
    const byName = this.byName.get(v.name);
    if (byName) {
      if (byName.owner === opts.owner) return byName;
      throw new Error(`${toFqdn(v.name)} is already taken`);
    }
    const existingName = this.byOwner.get(opts.owner);
    if (existingName) {
      const existing = this.byName.get(existingName);
      if (existing) {
        if (existingName === v.name) return existing;
        throw new Error(`Wallet already registered as ${toFqdn(existingName)}`);
      }
    }

    const meta = metaForOwner(opts.owner);
    const record: VeilNameRecord = {
      name: v.name,
      fqdn: toFqdn(v.name),
      owner: opts.owner,
      meta,
      createdAt: Date.now(),
      resolveCount: 0,
      inbox: [],
    };
    this.byName.set(v.name, record);
    this.byOwner.set(opts.owner, v.name);
    this.persist();
    return record;
  }

  resolve(nameOrFqdn: string): {
    record: VeilNameRecord;
    payment: StealthPayment & { index: number };
    announcement: StealthAnnouncement;
  } {
    this.ensureHydrated();
    const record = this.get(nameOrFqdn);
    if (!record) throw new Error(`Name not found: ${toFqdn(normalizeName(nameOrFqdn))}`);
    record.resolveCount += 1;
    // Never use resolveCount as the crypto index — serverless memory resets
    // replay 1,2,3… and regenerate the same addresses. Unique per resolve:
    const index = nextUniquePaymentIndex();
    const viewingSecret = viewingSecretForOwner(record.owner);
    const payment = generateIndexedStealthPayment(viewingSecret, index);
    const announcement: StealthAnnouncement = {
      ...payment,
      id: `recv_${index}`,
      createdAt: Date.now(),
      swept: false,
      index,
    };
    record.inbox.unshift(announcement);
    record.inbox = record.inbox.slice(0, 80);
    this.persist();
    return { record, payment, announcement };
  }

  prepareSweep(opts: { owner: string; announcementId: string }) {
    this.ensureHydrated();
    const record = this.getByOwner(opts.owner);
    if (!record) throw new Error("No .veil name for this wallet");
    const item = record.inbox.find((a) => a.id === opts.announcementId);
    if (!item) throw new Error("Announcement not found in inbox");

    const viewingSecret = viewingSecretForOwner(opts.owner);
    const sweep = deriveStealthSweepKey(viewingSecret, item.ephemeralPubKey, item.stealthAddress);
    return {
      record,
      announcement: item,
      stealthAddress: sweep.address,
      stealthSecret: sweep.secret,
      destination: record.owner,
      index: item.index,
      note: "Sweep moves spendable XLM from the one-time address to your Freighter.",
    };
  }

  /**
   * Candidates = legacy sequential indices (old bug) ∪ known inbox indices.
   */
  listSweepCandidates(owner: string, legacyUpto = 64) {
    this.ensureHydrated();
    const record = this.getByOwner(owner);
    const viewingSecret = viewingSecretForOwner(owner);
    const indices = new Set<number>();
    for (let i = 1; i <= legacyUpto; i++) indices.add(i);
    for (const a of record?.inbox ?? []) {
      if (a.index > 0) indices.add(a.index);
    }
    const out: Array<{ index: number; address: string; secret: string }> = [];
    for (const index of indices) {
      const { kp } = stealthKeypairAtIndex(viewingSecret, index);
      out.push({ index, address: kp.publicKey(), secret: kp.secret() });
    }
    return { record, candidates: out, destination: owner };
  }

  markSwept(owner: string, announcementId: string) {
    this.ensureHydrated();
    const record = this.getByOwner(owner);
    const item = record?.inbox.find((a) => a.id === announcementId);
    if (item) {
      item.swept = true;
      this.persist();
    }
  }

  markIndexSwept(owner: string, index: number) {
    this.ensureHydrated();
    const record = this.getByOwner(owner);
    const item = record?.inbox.find((a) => a.index === index);
    if (item) {
      item.swept = true;
      this.persist();
    }
  }
}

const globalStore = globalThis as unknown as { __veilpayVns?: VeilNameRegistry };

export function getVeilNameRegistry() {
  if (!globalStore.__veilpayVns) globalStore.__veilpayVns = new VeilNameRegistry();
  return globalStore.__veilpayVns;
}
