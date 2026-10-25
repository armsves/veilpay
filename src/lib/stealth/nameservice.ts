/**
 * Veilpay Name Service (VNS) — Fluidkey-style human-readable stealth ids.
 *
 * Users register `name.veil`. Resolving the name always returns a fresh
 * one-time Stellar stealth address controlled by the owner's meta-keys.
 * Announcements are kept so the owner can scan + sweep to Freighter.
 */

import nacl from "tweetnacl";
import { decodeUTF8 } from "tweetnacl-util";
import {
  deriveStealthKeysFromSeed,
  deriveStealthSweepKey,
  encodeMetaAddress,
  generateStealthPayment,
  type StealthMetaAddress,
  type StealthPayment,
} from "./testnet";

export const VNS_TLD = "veil";

export type StealthAnnouncement = StealthPayment & {
  id: string;
  createdAt: number;
  swept: boolean;
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

  list(): VeilNameRecord[] {
    return [...this.byName.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(nameOrFqdn: string): VeilNameRecord | null {
    const name = normalizeName(nameOrFqdn);
    return this.byName.get(name) ?? null;
  }

  getByOwner(owner: string): VeilNameRecord | null {
    const name = this.byOwner.get(owner);
    return name ? this.byName.get(name) ?? null : null;
  }

  available(nameOrFqdn: string): boolean {
    const v = validateName(nameOrFqdn);
    if (!v.ok) return false;
    return !this.byName.has(v.name);
  }

  register(opts: { name: string; owner: string }): VeilNameRecord {
    const v = validateName(opts.name);
    if (!v.ok) throw new Error(v.error);
    if (!opts.owner.startsWith("G") || opts.owner.length < 56) {
      throw new Error("Owner must be a Stellar G… address (connect Freighter)");
    }
    if (this.byName.has(v.name)) throw new Error(`${toFqdn(v.name)} is already taken`);
    const existing = this.byOwner.get(opts.owner);
    if (existing) throw new Error(`Wallet already registered as ${toFqdn(existing)}`);

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
    return record;
  }

  resolve(nameOrFqdn: string): {
    record: VeilNameRecord;
    payment: StealthPayment;
    announcement: StealthAnnouncement;
  } {
    const record = this.get(nameOrFqdn);
    if (!record) throw new Error(`Name not found: ${toFqdn(normalizeName(nameOrFqdn))}`);
    record.resolveCount += 1;
    const payment = generateStealthPayment(record.meta);
    const announcement: StealthAnnouncement = {
      ...payment,
      id: `recv_${Date.now()}_${record.resolveCount}`,
      createdAt: Date.now(),
      swept: false,
    };
    record.inbox.unshift(announcement);
    record.inbox = record.inbox.slice(0, 40);
    return { record, payment, announcement };
  }

  /**
   * Owner-only: recompute stealth secret from announcement + viewing key,
   * so funds can be swept to Freighter.
   */
  prepareSweep(opts: { owner: string; announcementId: string }) {
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
      note: "Import stealthSecret into Freighter (or Lab) and pay remaining balance to your main G… — or use POST sweep to build a payment XDR.",
    };
  }

  markSwept(owner: string, announcementId: string) {
    const record = this.getByOwner(owner);
    const item = record?.inbox.find((a) => a.id === announcementId);
    if (item) item.swept = true;
  }
}

const globalStore = globalThis as unknown as { __veilpayVns?: VeilNameRegistry };

export function getVeilNameRegistry() {
  if (!globalStore.__veilpayVns) globalStore.__veilpayVns = new VeilNameRegistry();
  return globalStore.__veilpayVns;
}
