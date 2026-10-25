/**
 * Move native XLM from a stealth burner to the owner's Freighter via RPC.
 */

import {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { currentNetwork } from "./config";
import { createRpcServer, fetchXlmBalance, submitAndConfirm } from "./rpc";

const KEEP_XLM = 1.5;

export async function sweepStealthToOwner(opts: {
  stealthSecret: string;
  stealthAddress: string;
  destination: string;
  submit: boolean;
}): Promise<
  | {
      ok: true;
      needsFunding: true;
      stealthAddress: string;
      balanceXlm: number;
      stealthSecret: string;
      destination: string;
    }
  | {
      ok: true;
      needsFunding?: false;
      submitted: boolean;
      amountXlm: number;
      from: string;
      to: string;
      hash?: string;
      xdr?: string;
      stealthSecret?: string;
    }
> {
  const balance = await fetchXlmBalance(opts.stealthAddress);
  if (balance <= 1.00001) {
    return {
      ok: true,
      needsFunding: true,
      stealthAddress: opts.stealthAddress,
      balanceXlm: balance,
      stealthSecret: opts.stealthSecret,
      destination: opts.destination,
    };
  }

  const sendAmount = Math.max(0, Math.floor((balance - KEEP_XLM) * 1e7) / 1e7);
  if (sendAmount <= 0) {
    throw new Error(`Balance ${balance} XLM too low to sweep after reserves`);
  }

  const net = currentNetwork();
  const server = createRpcServer();
  const source = await server.getAccount(opts.stealthAddress);
  const kp = Keypair.fromSecret(opts.stealthSecret);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: net.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: opts.destination,
        asset: Asset.native(),
        amount: sendAmount.toFixed(7),
      }),
    )
    .setTimeout(180)
    .build();
  tx.sign(kp);

  if (opts.submit) {
    const { hash } = await submitAndConfirm(tx);
    return {
      ok: true,
      submitted: true,
      amountXlm: sendAmount,
      from: opts.stealthAddress,
      to: opts.destination,
      hash,
    };
  }

  return {
    ok: true,
    submitted: false,
    amountXlm: sendAmount,
    from: opts.stealthAddress,
    to: opts.destination,
    xdr: tx.toXDR(),
    stealthSecret: opts.stealthSecret,
  };
}
