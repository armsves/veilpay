/**
 * Shield a stealth burner into the SPP pool, then privately transfer to the owner.
 *
 * Failed txs like 3248f0f4… trapped with:
 *   "resulting balance is not within the allowed range" [min=1 XLM, wouldBe=0.66…]
 * because a ~0.35 XLM SAC transfer left the burner under the 1 XLM protocol minimum
 * after Soroban fees. Keep integer stroop math + real headroom.
 */

"use client";

import { currentNetwork } from "@/lib/stellar/config";
import { fetchXlmBalance, fetchXlmBalanceStroops } from "@/lib/stellar/rpc";
import { StealthKeypairSigner } from "./keypair-signer";
import { createSppClient, stroopsToXlm } from "./session";

/** Classic account minimum (2 × 0.5 XLM base reserve). */
const BASE_RESERVE_STROOPS = 10_000_000n;
/**
 * Soroban resource/inclusion fees + safety margin. The failed deposit used only
 * ~0.15 XLM pad and still dipped under reserve.
 */
const FEE_HEADROOM_STROOPS = 5_000_000n; // 0.5 XLM
/** Don't bother shielding tiny notes. */
const MIN_DEPOSIT_STROOPS = 10_000_000n; // 1 XLM

/** Balance needed before a shield attempt: 1 XLM reserve + 0.5 fee + 1 XLM deposit. */
export const MIN_SHIELD_BALANCE_XLM = 2.5;

export type ShieldResult = {
  depositedXlm: string;
  transferredXlm: string;
  owner: string;
  stealthAddress: string;
  leftoverXlm: number;
};

/** Max stroops we can deposit without leaving the burner under 1 XLM after fees. */
export function maxDepositStroops(balanceStroops: bigint): bigint {
  const max = balanceStroops - BASE_RESERVE_STROOPS - FEE_HEADROOM_STROOPS;
  return max >= MIN_DEPOSIT_STROOPS ? max : 0n;
}

/**
 * 1) Ensure owner Freighter is SPP-registered (for private receive).
 * 2) Stealth deposits into XLM pool (one sized deposit; optional second pass).
 * 3) Private-transfer full shielded balance → owner.
 */
export async function shieldStealthViaSpp(opts: {
  stealthSecret: string;
  stealthAddress: string;
  ownerAddress: string;
  onProgress?: (msg: string) => void;
}): Promise<ShieldResult> {
  const push = opts.onProgress ?? (() => undefined);
  const opening = await fetchXlmBalanceStroops(opts.stealthAddress);
  const firstDeposit = maxDepositStroops(opening);
  if (firstDeposit <= 0n) {
    const have = stroopsToXlm(opening);
    throw new Error(
      `Need ≥${MIN_SHIELD_BALANCE_XLM} XLM on the stealth address to SPP-shield (have ${have}). ` +
        `Must leave 1 XLM base reserve + ~0.5 XLM Soroban fees; depositing more traps with ` +
        `"resulting balance is not within the allowed range".`,
    );
  }

  let stealthSession: Awaited<ReturnType<typeof createSppClient>>;
  try {
    push("Ensuring your Freighter is registered on the SPP pool…");
    await createSppClient({ userAddress: opts.ownerAddress });

    push("Opening SPP session as stealth burner…");
    const signer = new StealthKeypairSigner(
      opts.stealthSecret,
      currentNetwork().networkPassphrase,
    );
    stealthSession = await createSppClient({
      userAddress: opts.stealthAddress,
      signer,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/local database|Access Handle|OPFS|another tab/i.test(msg)) {
      throw new Error(
        "SPP storage is locked — close other Veilpay / Private pay tabs using SPP, then reload this page and retry.",
      );
    }
    throw e;
  }

  let totalDeposited = 0n;
  let totalTransferred = 0n;

  for (let pass = 1; pass <= 2; pass++) {
    const native = await fetchXlmBalanceStroops(opts.stealthAddress);
    const depositStroops = maxDepositStroops(native);
    if (depositStroops <= 0n) break;

    push(`Deposit pass ${pass}: ${stroopsToXlm(depositStroops)} XLM from stealth → SPP pool…`);
    try {
      await stealthSession.pool.deposit(depositStroops);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/allowed range|balance is not within|trapped|HostError/i.test(msg)) {
        throw new Error(
          `SPP deposit trapped: would leave burner under the 1 XLM minimum. ` +
            `Send more XLM to the stealth address (need ≥${MIN_SHIELD_BALANCE_XLM} XLM total) and retry. (${msg})`,
        );
      }
      throw e;
    }
    totalDeposited += depositStroops;

    const shielded = await stealthSession.pool.balance();
    if (shielded > 0n) {
      push(`Private transfer pass ${pass}: ${stroopsToXlm(shielded)} XLM → you (inside pool)…`);
      await stealthSession.pool.transfer(opts.ownerAddress, shielded);
      totalTransferred += shielded;
    }
  }

  if (totalDeposited <= 0n) {
    throw new Error(
      `Nothing deposited — stealth balance too low after fees (need ≥${MIN_SHIELD_BALANCE_XLM} XLM).`,
    );
  }

  const leftoverXlm = await fetchXlmBalance(opts.stealthAddress);
  push(
    `Shielded via SPP. ~${leftoverXlm.toFixed(2)} XLM stays on the burner (1 XLM reserve + fee headroom).`,
  );

  return {
    depositedXlm: stroopsToXlm(totalDeposited),
    transferredXlm: stroopsToXlm(totalTransferred),
    owner: opts.ownerAddress,
    stealthAddress: opts.stealthAddress,
    leftoverXlm,
  };
}
