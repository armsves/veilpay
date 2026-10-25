/**
 * Browser-side native XLM payment via Freighter + Horizon.
 * New stealth addresses need CreateAccount (≥1 XLM); funded ones use Payment.
 */

import {
  Asset,
  BASE_FEE,
  Horizon,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { currentNetwork } from "./config";
import { signXdr } from "./wallet";

export type SendXlmResult = {
  hash: string;
  amount: string;
  to: string;
  createdAccount: boolean;
};

/** Horizon-friendly fixed decimals (7). */
export function formatXlmAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Enter a positive XLM amount");
  }
  return (Math.round(n * 1e7) / 1e7).toFixed(7);
}

async function accountExists(horizon: Horizon.Server, address: string): Promise<boolean> {
  try {
    await horizon.loadAccount(address);
    return true;
  } catch (e) {
    const err = e as { response?: { status?: number } };
    if (err.response?.status === 404) return false;
    throw e;
  }
}

/**
 * Sign + submit a native XLM transfer from `from` (Freighter) to `to`.
 */
export async function sendXlm(opts: {
  from: string;
  to: string;
  amount: string;
}): Promise<SendXlmResult> {
  const amount = formatXlmAmount(opts.amount);
  const net = currentNetwork();
  const horizon = new Horizon.Server(net.horizonUrl);
  const source = await horizon.loadAccount(opts.from);
  const exists = await accountExists(horizon, opts.to);

  if (!exists && Number(amount) < 1) {
    throw new Error("First payment to a new stealth address must be at least 1 XLM (create account)");
  }

  const builder = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: net.networkPassphrase,
  });

  if (!exists) {
    builder.addOperation(
      Operation.createAccount({
        destination: opts.to,
        startingBalance: amount,
      }),
    );
  } else {
    builder.addOperation(
      Operation.payment({
        destination: opts.to,
        asset: Asset.native(),
        amount,
      }),
    );
  }

  const tx = builder.setTimeout(180).build();
  const signedXdr = await signXdr(tx.toXDR(), opts.from);
  const signed = TransactionBuilder.fromXDR(signedXdr, net.networkPassphrase);
  const result = await horizon.submitTransaction(signed);

  return {
    hash: result.hash,
    amount,
    to: opts.to,
    createdAccount: !exists,
  };
}

export function horizonTxUrl(hash: string) {
  const net = currentNetwork();
  const isTest = net.horizonUrl.includes("testnet");
  return isTest
    ? `https://stellar.expert/explorer/testnet/tx/${hash}`
    : `https://stellar.expert/explorer/public/tx/${hash}`;
}
