/**
 * Owner-signed solvency admin ops on the confidential token (server-only).
 * Uses VNS_REGISTRY_SECRET — same keypair as the on-chain token owner.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { CONFIDENTIAL_TOKEN_ID } from "./config";

const RPC = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

function ownerKeypair(): Keypair {
  const secret = process.env.VNS_REGISTRY_SECRET?.trim();
  if (!secret) throw new Error("VNS_REGISTRY_SECRET not set — cannot sign force_panic");
  return Keypair.fromSecret(secret);
}

async function adminClient() {
  const { Client, networks } = await import("./token-bindings");
  const kp = ownerKeypair();
  return {
    kp,
    client: new Client({
      contractId: CONFIDENTIAL_TOKEN_ID,
      networkPassphrase: networks.testnet.networkPassphrase,
      rpcUrl: RPC,
      publicKey: kp.publicKey(),
      signTransaction: kp,
    }),
  };
}

/** Freeze the confidential pool on-chain until unpause. */
export async function forcePanicOnchain(): Promise<{ hash: string; owner: string }> {
  const { kp, client } = await adminClient();
  const tx = await client.force_panic({ owner: kp.publicKey() });
  const sent = await tx.signAndSend();
  const hash =
    (sent as { hash?: string }).hash ??
    (sent as { resultMetaXdr?: unknown; getTransactionResponse?: { txHash?: string } })
      .getTransactionResponse?.txHash ??
    "submitted";
  return { hash: String(hash), owner: kp.publicKey() };
}

/** Permissionless: halt if B/L already under min coverage. */
export async function haltIfInsolventOnchain(): Promise<{
  hash: string;
  panic_halt: boolean;
  coverage_bps: number;
}> {
  const { Client, networks } = await import("./token-bindings");
  const kp = ownerKeypair();
  const client = new Client({
    contractId: CONFIDENTIAL_TOKEN_ID,
    networkPassphrase: networks.testnet.networkPassphrase,
    rpcUrl: RPC,
    publicKey: kp.publicKey(),
    signTransaction: kp,
  });
  const tx = await client.halt_if_insolvent();
  const sent = await tx.signAndSend();
  const view = (sent as { result?: { panic_halt: boolean; coverage_bps: number } }).result;
  const hash =
    (sent as { hash?: string }).hash ??
    (sent as { getTransactionResponse?: { txHash?: string } }).getTransactionResponse?.txHash ??
    "submitted";
  return {
    hash: String(hash),
    panic_halt: Boolean(view?.panic_halt),
    coverage_bps: Number(view?.coverage_bps ?? 0),
  };
}

/** Clear panic when coverage is restored. */
export async function unpauseOnchain(): Promise<{ hash: string }> {
  const { kp, client } = await adminClient();
  const tx = await client.unpause({ owner: kp.publicKey() });
  const sent = await tx.signAndSend();
  const hash =
    (sent as { hash?: string }).hash ??
    (sent as { getTransactionResponse?: { txHash?: string } }).getTransactionResponse?.txHash ??
    "submitted";
  return { hash: String(hash) };
}
