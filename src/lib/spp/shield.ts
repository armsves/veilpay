/**
 * Shield a stealth burner into the SPP pool, then privately transfer to the owner.
 * Avoids a public payment stealth → Freighter (which links the receive).
 */

"use client";

import { currentNetwork } from "@/lib/stellar/config";
import { fetchXlmBalance } from "@/lib/stellar/rpc";
import { StealthKeypairSigner } from "./keypair-signer";
import { createSppClient, xlmToStroops, stroopsToXlm } from "./session";

/** Native XLM left on the burner for Soroban fees (register + deposit + transfer). */
const FEE_BUFFER_XLM = 2;

export type ShieldResult = {
  depositedXlm: string;
  transferredXlm: string;
  owner: string;
  stealthAddress: string;
  leftoverXlm: number;
};

/**
 * 1) Ensure owner Freighter is SPP-registered (for private receive).
 * 2) Stealth account deposits into XLM pool (public ext_amount from burner).
 * 3) Stealth privately transfers notes → owner (ext_amount 0).
 */
export async function shieldStealthViaSpp(opts: {
  stealthSecret: string;
  stealthAddress: string;
  ownerAddress: string;
  onProgress?: (msg: string) => void;
}): Promise<ShieldResult> {
  const push = opts.onProgress ?? (() => undefined);
  const balance = await fetchXlmBalance(opts.stealthAddress);
  const depositXlm = Math.floor((balance - FEE_BUFFER_XLM) * 1e7) / 1e7;
  if (depositXlm < 1) {
    throw new Error(
      `Need at least ${FEE_BUFFER_XLM + 1} XLM on the stealth address to shield via SPP (have ${balance}). Fee buffer keeps ~${FEE_BUFFER_XLM} XLM for Soroban txs.`,
    );
  }

  push("Ensuring your Freighter is registered on the SPP pool…");
  await createSppClient({ userAddress: opts.ownerAddress });

  push("Opening SPP session as stealth burner…");
  const signer = new StealthKeypairSigner(
    opts.stealthSecret,
    currentNetwork().networkPassphrase,
  );
  const stealthSession = await createSppClient({
    userAddress: opts.stealthAddress,
    signer,
  });

  const depositStroops = xlmToStroops(depositXlm.toFixed(7));
  push(`Depositing ${depositXlm} XLM from stealth into SPP pool (public ext_amount)…`);
  await stealthSession.pool.deposit(depositStroops);

  push(`Private transfer ${depositXlm} XLM → your Freighter inside the pool…`);
  await stealthSession.pool.transfer(opts.ownerAddress, depositStroops);

  const leftoverXlm = await fetchXlmBalance(opts.stealthAddress);
  push(`Shielded. ~${leftoverXlm.toFixed(2)} XLM fee dust may remain on the burner (not sent to Freighter).`);

  return {
    depositedXlm: stroopsToXlm(depositStroops),
    transferredXlm: stroopsToXlm(depositStroops),
    owner: opts.ownerAddress,
    stealthAddress: opts.stealthAddress,
    leftoverXlm,
  };
}
