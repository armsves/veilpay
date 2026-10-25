/**
 * Browser-side native XLM payment via Freighter + Stellar RPC.
 * New stealth addresses need CreateAccount (≥1 XLM); funded ones use Payment.
 */

import {
  Asset,
  BASE_FEE,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { currentNetwork } from "./config";
import {
  accountExists,
  createRpcServer,
  explorerTxUrl,
  submitAndConfirm,
} from "./rpc";
import { signXdr } from "./wallet";

export type SendXlmResult = {
  hash: string;
  amount: string;
  to: string;
  createdAccount: boolean;
};

/** Fixed 7-decimal amount string for classic ops. */
export function formatXlmAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Enter a positive XLM amount");
  }
  return (Math.round(n * 1e7) / 1e7).toFixed(7);
}

/**
 * Sign + submit a native XLM transfer from `from` (Freighter) to `to` via RPC.
 */
export async function sendXlm(opts: {
  from: string;
  to: string;
  amount: string;
  /** Optional classic memo (e.g. `vp:12` payment index for VNS recovery). */
  memoText?: string;
}): Promise<SendXlmResult> {
  const amount = formatXlmAmount(opts.amount);
  const net = currentNetwork();
  const server = createRpcServer();
  const source = await server.getAccount(opts.from);
  const exists = await accountExists(opts.to);

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

  if (opts.memoText) {
    const text = opts.memoText.slice(0, 28);
    builder.addMemo(Memo.text(text));
  }

  const tx = builder.setTimeout(180).build();
  const signedXdr = await signXdr(tx.toXDR(), opts.from);
  const signed = TransactionBuilder.fromXDR(signedXdr, net.networkPassphrase);
  const { hash } = await submitAndConfirm(signed);

  return {
    hash,
    amount,
    to: opts.to,
    createdAccount: !exists,
  };
}

export { explorerTxUrl };
