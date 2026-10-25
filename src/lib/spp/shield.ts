/**
 * Shield a stealth burner into the SPP pool as notes owned by Freighter.
 *
 * Important: deposit with userAddress=owner + signer=stealth so notes are
 * created under the same privacy keys Private pay already uses. The old
 * deposit-as-stealth → transfer(G…)/transferToKeys path left balances at 0
 * even when direct Freighter deposits worked.
 */

"use client";

import { currentNetwork } from "@/lib/stellar/config";
import { fetchXlmBalance, fetchXlmBalanceStroops } from "@/lib/stellar/rpc";
import { StealthKeypairSigner } from "./keypair-signer";
import {
  createOwnerNotesPaidByStealth,
  createSppClient,
  stroopsToXlm,
} from "./session";

/** Classic account minimum (2 × 0.5 XLM base reserve). */
const BASE_RESERVE_STROOPS = 10_000_000n;
const FEE_HEADROOM_STROOPS = 5_000_000n; // 0.5 XLM
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

type OwnerKeys = { notePublicKey: string; encryptionPublicKey: string };

export function maxDepositStroops(balanceStroops: bigint): bigint {
  const max = balanceStroops - BASE_RESERVE_STROOPS - FEE_HEADROOM_STROOPS;
  return max >= MIN_DEPOSIT_STROOPS ? max : 0n;
}

async function readBalanceWithSync(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  rounds = 4,
): Promise<bigint> {
  let last = 0n;
  for (let i = 0; i < rounds; i++) {
    await client.sync();
    last = await pool.balance();
    if (last > 0n) return last;
    await new Promise((r) => setTimeout(r, 600));
  }
  return last;
}

/**
 * Stealth pays; Freighter owns the shielded notes (same keys as Private pay Deposit).
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
        `Must leave 1 XLM base reserve + ~0.5 XLM Soroban fees.`,
    );
  }

  const signer = new StealthKeypairSigner(
    opts.stealthSecret,
    currentNetwork().networkPassphrase,
  );

  let depositSession: Awaited<ReturnType<typeof createOwnerNotesPaidByStealth>>;
  try {
    push("Preparing Freighter SPP keys, then depositing from stealth into your notes…");
    depositSession = await createOwnerNotesPaidByStealth({
      ownerAddress: opts.ownerAddress,
      stealthAddress: opts.stealthAddress,
      stealthSigner: signer,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/local database|Access Handle|OPFS|another tab/i.test(msg)) {
      throw new Error(
        "SPP storage is locked — close other Veilpay / Private pay tabs, reload, then retry Shield.",
      );
    }
    if (/SignerIsNotNoteOwner|signer.*owner|derivePrivacyKeys/i.test(msg)) {
      throw new Error(
        "Connect Freighter as the .veil owner first (header), open Private pay → Connect SPP once, then Shield again.",
      );
    }
    throw e;
  }

  let totalDeposited = 0n;

  for (let pass = 1; pass <= 2; pass++) {
    const native = await fetchXlmBalanceStroops(opts.stealthAddress);
    const depositStroops = maxDepositStroops(native);
    if (depositStroops <= 0n) break;

    push(
      `Deposit pass ${pass}: ${stroopsToXlm(depositStroops)} XLM from stealth → your shielded balance…`,
    );
    try {
      await depositSession.pool.deposit(depositStroops);
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
  }

  if (totalDeposited <= 0n) {
    throw new Error(
      `Nothing deposited — stealth balance too low after fees (need ≥${MIN_SHIELD_BALANCE_XLM} XLM).`,
    );
  }

  push("Syncing your Freighter pool balance…");
  // Re-open as Freighter-only so balance() uses the same account Private pay uses.
  const ownerSession = await createSppClient({ userAddress: opts.ownerAddress });
  const ownerBal = await readBalanceWithSync(ownerSession.client, ownerSession.pool);
  const leftoverXlm = await fetchXlmBalance(opts.stealthAddress);

  if (ownerBal <= 0n) {
    throw new Error(
      `Deposited ${stroopsToXlm(totalDeposited)} XLM on-chain but Private pay still reads 0 after sync. ` +
        `Open Private pay → Refresh. If still 0, try Stealth → Reclaim on this burner.`,
    );
  }

  push(
    `Shielded balance is now ${stroopsToXlm(ownerBal)} XLM. Open Private pay → Withdraw when you want XLM in Freighter. ~${leftoverXlm.toFixed(2)} XLM stays on the burner.`,
  );

  return {
    depositedXlm: stroopsToXlm(totalDeposited),
    transferredXlm: stroopsToXlm(ownerBal),
    owner: opts.ownerAddress,
    stealthAddress: opts.stealthAddress,
    leftoverXlm,
  };
}

/**
 * Move notes that still sit on a stealth burner into the owner’s Freighter keys.
 * Used only for leftovers from the old deposit-as-stealth + transfer path.
 */
export async function reclaimStealthPoolNotes(opts: {
  stealthSecret: string;
  stealthAddress: string;
  ownerAddress: string;
  onProgress?: (msg: string) => void;
}): Promise<ShieldResult> {
  const push = opts.onProgress ?? (() => undefined);

  push("Loading your Freighter SPP keys…");
  const ownerSession = await createSppClient({ userAddress: opts.ownerAddress });
  const keysRaw = await ownerSession.account.privacyKeys();
  const ownerKeys: OwnerKeys = {
    notePublicKey: keysRaw.notePublicKey,
    encryptionPublicKey: keysRaw.encryptionPublicKey,
  };

  push("Opening stealth pool session…");
  const signer = new StealthKeypairSigner(
    opts.stealthSecret,
    currentNetwork().networkPassphrase,
  );
  const stealthSession = await createSppClient({
    userAddress: opts.stealthAddress,
    signer,
  });

  push("Syncing stealth notes…");
  await stealthSession.client.sync();
  let shielded = await stealthSession.pool.balance();
  if (shielded <= 0n) {
    shielded = await readBalanceWithSync(stealthSession.client, stealthSession.pool, 3);
  }
  if (shielded <= 0n) {
    throw new Error(
      "No spendable notes left on this stealth burner — they were already moved or never deposited as stealth.",
    );
  }

  push(`Moving ${stroopsToXlm(shielded)} XLM → your Freighter SPP keys…`);
  await stealthSession.pool.transferToKeys(
    ownerKeys.notePublicKey,
    ownerKeys.encryptionPublicKey,
    shielded,
  );

  const ownerBal = await readBalanceWithSync(ownerSession.client, ownerSession.pool);
  const leftoverXlm = await fetchXlmBalance(opts.stealthAddress);
  if (ownerBal <= 0n) {
    throw new Error(
      "Reclaim transfer submitted but owner pool still reads 0 — hit Refresh on Private pay.",
    );
  }

  push(`Reclaimed ${stroopsToXlm(ownerBal)} XLM into Private pay.`);
  return {
    depositedXlm: "0",
    transferredXlm: stroopsToXlm(ownerBal),
    owner: opts.ownerAddress,
    stealthAddress: opts.stealthAddress,
    leftoverXlm,
  };
}
