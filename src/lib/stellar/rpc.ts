/**
 * Stellar RPC helpers — Horizon is EOL; use RPC for accounts + submit.
 * @see https://developers.stellar.org/docs/data/apis/migrate-from-horizon-to-rpc
 */

import { rpc, type Transaction, type FeeBumpTransaction } from "@stellar/stellar-sdk";
import { currentNetwork, networkMode } from "./config";

export function createRpcServer() {
  return new rpc.Server(currentNetwork().rpcUrl, { allowHttp: false });
}

/** Sequence-bearing Account for TransactionBuilder, or null if missing. */
export async function loadAccountOrNull(address: string) {
  const server = createRpcServer();
  try {
    return await server.getAccount(address);
  } catch {
    return null;
  }
}

export async function accountExists(address: string): Promise<boolean> {
  return (await loadAccountOrNull(address)) !== null;
}

/** Native XLM balance in decimal XLM (0 if account missing). */
export async function fetchXlmBalance(address: string): Promise<number> {
  const server = createRpcServer();
  try {
    const entry = await server.getAccountEntry(address);
    const stroops = BigInt(entry.balance.toString());
    return Number(stroops) / 1e7;
  } catch {
    return 0;
  }
}

/**
 * Enqueue via RPC sendTransaction, then poll until SUCCESS / FAILED.
 */
export async function submitAndConfirm(
  signed: Transaction | FeeBumpTransaction,
): Promise<{ hash: string }> {
  const server = createRpcServer();
  const sent = await server.sendTransaction(signed);

  if (sent.status === "ERROR") {
    throw new Error("RPC rejected transaction (check fee / sequence / balance)");
  }
  if (sent.status === "TRY_AGAIN_LATER") {
    throw new Error("RPC busy — try again shortly");
  }

  const final = await server.pollTransaction(sent.hash, {
    attempts: 30,
    sleepStrategy: rpc.LinearSleepStrategy,
  });

  if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new Error("Transaction failed on-chain");
  }
  if (final.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    throw new Error("Transaction not confirmed in time — check explorer with hash " + sent.hash);
  }

  return { hash: sent.hash };
}

export function explorerTxUrl(hash: string) {
  return networkMode === "mainnet"
    ? `https://stellar.expert/explorer/public/tx/${hash}`
    : `https://stellar.expert/explorer/testnet/tx/${hash}`;
}
