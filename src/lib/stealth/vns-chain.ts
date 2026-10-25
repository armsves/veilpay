/**
 * Durable .veil name registry via Stellar account manageData.
 * Reads/writes go through **Stellar RPC only** (Horizon is EOL — do not use).
 *
 * Key:   `v:<name>`   (e.g. v:alice) — max 64 bytes
 * Value: owner G… address as UTF-8 (56 bytes)
 *
 * Survives Vercel cold starts. Writes need VNS_REGISTRY_SECRET (server-only).
 */

import {
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { currentNetwork } from "@/lib/stellar/config";
import {
  createRpcServer,
  loadAccountOrNull,
  submitAndConfirm,
} from "@/lib/stellar/rpc";

const PREFIX = "v:";

export function registryAddress(): string {
  return (
    process.env.NEXT_PUBLIC_VNS_REGISTRY_ADDRESS ??
    process.env.VNS_REGISTRY_ADDRESS ??
    "GCWCP6UXP7XCZYZML5XEF26FL7HUCRONBO6PTPELKERARB2DS4D6VFEC"
  );
}

function dataKey(name: string): string {
  const n = name.trim().toLowerCase().replace(/\.veil$/i, "");
  const key = `${PREFIX}${n}`;
  if (key.length > 64) throw new Error("Name too long for on-chain registry");
  return key;
}

function ledgerKeyFor(name: string): xdr.LedgerKey {
  const accountId = Keypair.fromPublicKey(registryAddress()).xdrAccountId();
  return xdr.LedgerKey.data(
    new xdr.LedgerKeyData({
      accountId,
      dataName: dataKey(name),
    }),
  );
}

/** Extract UTF-8 manageData payload from an RPC getLedgerEntries row. */
function decodeDataValue(entry: { val?: unknown }): string | null {
  try {
    const val = entry.val as {
      data?: { dataValue?: { value?: Uint8Array } | Uint8Array | Buffer };
      value?: { dataValue?: { value?: Uint8Array } | Uint8Array | Buffer };
    };
    const data = val?.data ?? val?.value;
    const dv = data?.dataValue;
    if (!dv) return null;
    const bytes =
      dv instanceof Uint8Array || Buffer.isBuffer(dv)
        ? dv
        : (dv as { value?: Uint8Array }).value;
    if (!bytes) return null;
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return null;
  }
}

/** Public read via RPC getLedgerEntries — owner G… or null. */
export async function chainGetOwner(name: string): Promise<string | null> {
  try {
    const server = createRpcServer();
    const { entries } = await server.getLedgerEntries(ledgerKeyFor(name));
    const entry = entries?.[0] as
      | { val?: { data?: { dataValue?: Buffer | Uint8Array } } }
      | undefined;
    if (!entry) return null;
    const owner = decodeDataValue(entry);
    return owner?.startsWith("G") && owner.length >= 56 ? owner : null;
  } catch {
    return null;
  }
}

/**
 * RPC cannot enumerate all manageData keys without knowing names.
 * Hydration of unknown names uses {@link chainGetOwner} per lookup instead.
 */
export async function chainListNames(): Promise<Array<{ name: string; owner: string }>> {
  return [];
}

/** Persist name→owner on-chain via RPC sendTransaction. */
export async function chainPutName(
  name: string,
  owner: string,
): Promise<{ hash: string | null; skipped?: boolean; error?: string }> {
  const secret = process.env.VNS_REGISTRY_SECRET?.trim();
  if (!secret) {
    return { hash: null, error: "VNS_REGISTRY_SECRET not set — name kept in memory/tmp only" };
  }
  if (!owner.startsWith("G") || owner.length < 56) {
    return { hash: null, error: "Invalid owner address" };
  }

  const key = dataKey(name);
  const existing = await chainGetOwner(name);
  if (existing === owner) return { hash: null, skipped: true };
  if (existing && existing !== owner) {
    return { hash: null, error: `${name}.veil already claimed on-chain by another wallet` };
  }

  try {
    const kp = Keypair.fromSecret(secret);
    if (kp.publicKey() !== registryAddress()) {
      return {
        hash: null,
        error: "VNS_REGISTRY_SECRET does not match NEXT_PUBLIC_VNS_REGISTRY_ADDRESS",
      };
    }
    const account = await loadAccountOrNull(kp.publicKey());
    if (!account) {
      return { hash: null, error: "Registry account not found on RPC" };
    }
    const value = Buffer.from(owner, "utf8");
    if (value.length > 64) return { hash: null, error: "Owner value too long" };

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: currentNetwork().networkPassphrase,
    })
      .addOperation(
        Operation.manageData({
          name: key,
          value,
        }),
      )
      .setTimeout(180)
      .build();
    tx.sign(kp);
    const { hash } = await submitAndConfirm(tx);
    return { hash };
  } catch (e) {
    return { hash: null, error: e instanceof Error ? e.message : String(e) };
  }
}
