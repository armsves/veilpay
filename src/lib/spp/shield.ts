/**
 * Shield a stealth burner into the SPP pool, then privately transfer to the owner.
 * Avoids a public payment stealth → Freighter (which links the receive).
 *
 * Multipass deposits leave only the Stellar base reserve (~1 XLM) on the burner —
 * not a fat 2 XLM "fee dust" pad. That last 1 XLM is protocol minimum for an open
 * account; reclaiming it requires account-merge (public link), which we skip.
 */

"use client";

import { currentNetwork } from "@/lib/stellar/config";
import { fetchXlmBalance } from "@/lib/stellar/rpc";
import { StealthKeypairSigner } from "./keypair-signer";
import { createSppClient, xlmToStroops, stroopsToXlm } from "./session";

/** Protocol minimum for an account with no subentries (2 × 0.5 XLM base reserve). */
const BASE_RESERVE_XLM = 1;
/** Tiny pad so the next Soroban tx can pay fees without dipping under reserve. */
const TX_FEE_PAD_XLM = 0.15;
/** Don't bother depositing below this. */
const MIN_DEPOSIT_XLM = 0.05;

export type ShieldResult = {
  depositedXlm: string;
  transferredXlm: string;
  owner: string;
  stealthAddress: string;
  leftoverXlm: number;
};

function spendableDepositXlm(balance: number): number {
  const amt = Math.floor((balance - BASE_RESERVE_XLM - TX_FEE_PAD_XLM) * 1e7) / 1e7;
  return amt >= MIN_DEPOSIT_XLM ? amt : 0;
}

/**
 * 1) Ensure owner Freighter is SPP-registered (for private receive).
 * 2) Stealth deposits into XLM pool (repeat while spendable native remains).
 * 3) After each deposit, private-transfer full shielded balance → owner.
 */
export async function shieldStealthViaSpp(opts: {
  stealthSecret: string;
  stealthAddress: string;
  ownerAddress: string;
  onProgress?: (msg: string) => void;
}): Promise<ShieldResult> {
  const push = opts.onProgress ?? (() => undefined);
  const opening = await fetchXlmBalance(opts.stealthAddress);
  if (spendableDepositXlm(opening) <= 0) {
    throw new Error(
      `Need more than ~${(BASE_RESERVE_XLM + TX_FEE_PAD_XLM + MIN_DEPOSIT_XLM).toFixed(2)} XLM on the stealth address to shield (have ${opening}).`,
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

  let totalDeposited = 0n;
  let totalTransferred = 0n;

  for (let pass = 1; pass <= 3; pass++) {
    const native = await fetchXlmBalance(opts.stealthAddress);
    const depositXlm = spendableDepositXlm(native);
    if (depositXlm <= 0) break;

    const depositStroops = xlmToStroops(depositXlm.toFixed(7));
    push(`Deposit pass ${pass}: ${depositXlm} XLM from stealth → SPP pool…`);
    await stealthSession.pool.deposit(depositStroops);
    totalDeposited += depositStroops;

    const shielded = await stealthSession.pool.balance();
    if (shielded > 0n) {
      push(`Private transfer pass ${pass}: ${stroopsToXlm(shielded)} XLM → you (inside pool)…`);
      await stealthSession.pool.transfer(opts.ownerAddress, shielded);
      totalTransferred += shielded;
    }
  }

  const leftoverXlm = await fetchXlmBalance(opts.stealthAddress);
  push(
    `Shielded via SPP. ~${leftoverXlm.toFixed(2)} XLM stays on the burner (Stellar base reserve — reclaiming it would require a public account-merge).`,
  );

  return {
    depositedXlm: stroopsToXlm(totalDeposited),
    transferredXlm: stroopsToXlm(totalTransferred),
    owner: opts.ownerAddress,
    stealthAddress: opts.stealthAddress,
    leftoverXlm,
  };
}
