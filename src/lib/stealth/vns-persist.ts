/**
 * Best-effort durable VNS snapshot for serverless.
 * Writes /tmp (survives warm instances) + in-process mirror.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export type PersistedAnnouncement = {
  id: string;
  stealthAddress: string;
  ephemeralPubKey: string;
  viewTag: number;
  memoHint: string;
  index?: number;
  createdAt: number;
  swept: boolean;
};

export type PersistedRecord = {
  name: string;
  fqdn: string;
  owner: string;
  metaEncoded: string;
  createdAt: number;
  resolveCount: number;
  inbox: PersistedAnnouncement[];
};

export type PersistedRegistry = {
  version: 2;
  records: PersistedRecord[];
};

const TMP = "/tmp/veilpay-vns.json";
const LOCAL = join(process.cwd(), ".data", "vns.json");

function paths(): string[] {
  return [TMP, LOCAL];
}

export function loadPersistedRegistry(): PersistedRegistry | null {
  for (const p of paths()) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, "utf8");
      const data = JSON.parse(raw) as PersistedRegistry;
      if (data?.version === 2 && Array.isArray(data.records)) return data;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function savePersistedRegistry(data: PersistedRegistry) {
  const body = JSON.stringify(data);
  try {
    writeFileSync(TMP, body, "utf8");
  } catch {
    /* ignore */
  }
  try {
    mkdirSync(join(process.cwd(), ".data"), { recursive: true });
    writeFileSync(LOCAL, body, "utf8");
  } catch {
    /* read-only FS on some hosts */
  }
}
