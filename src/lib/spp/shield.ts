/**
 * Shield a stealth burner into the SPP pool, then privately transfer to the owner.
 *
 * Failed txs like 3248f0f4… trapped with:
 *   "resulting balance is not within the allowed range" [min=1 XLM, wouldBe=0.66…]
 * because a ~0.35 XLM SAC transfer left the burner under the 1 XLM protocol minimum
 * after Soroban fees. Keep integer stroop math + real headroom.
 *
 * Private transfer MUST use transferToKeys(owner.privacyKeys()), not transfer(G…).
 * Address lookup reads the on-chain registry via local indexer — which can still
 * hold keys from another SPP app origin (e.g. the Nethermind demo). Encrypting
 * to those keys makes notes invisible in Veilpay’s OPFS wallet.
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

type OwnerKeys = { notePublicKey: string; encryptionPublicKey: string };

/** Max stroops we can deposit without leaving the burner under 1 XLM after fees. */
export function maxDepositStroops(balanceStroops: bigint): bigint {
  const max = balanceStroops - BASE_RESERVE_STROOPS - FEE_HEADROOM_STROOPS;
  return max >= MIN_DEPOSIT_STROOPS ? max : 0n;
}

async function ownerPrivacyKeys(ownerAddress: string): Promise<{
  session: Awaited<ReturnType<typeof createSppClient>>;
  keys: OwnerKeys;
}> {
  const session = await createSppClient({ userAddress: ownerAddress });
  const keys = await session.account.privacyKeys();
  return {
    session,
    keys: {
      notePublicKey: keys.notePublicKey,
      encryptionPublicKey: keys.encryptionPublicKey,
    },
  };
}

async function transferToOwner(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stealthPool: any,
  keys: OwnerKeys,
  amount: bigint,
) {
  await stealthPool.transferToKeys(keys.notePublicKey, keys.encryptionPublicKey, amount);
}

async function readBalanceWithSync(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  rounds = 3,
): Promise<bigint> {
  let last = 0n;
  for (let i = 0; i < rounds; i++) {
    await client.sync();
    last = await pool.balance();
    if (last > 0n) return last;
    await new Promise((r) => setTimeout(r, 800));
  }
  return last;
}

/**
 * 1) Derive owner Freighter privacy keys (local OPFS — what decrypts notes here).
 * 2) Stealth deposits into XLM pool.
 * 3) Private-transfer via transferToKeys → those exact keys (not registry lookup).
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
  let ownerSession: Awaited<ReturnType<typeof createSppClient>>;
  let ownerKeys: OwnerKeys;
  try {
    push("Deriving your Freighter SPP keys (Veilpay wallet — not the public registry)…");
    ({ session: ownerSession, keys: ownerKeys } = await ownerPrivacyKeys(opts.ownerAddress));

    // Warn if on-chain registry points at different keys (common after using the Nethermind demo).
    try {
      await ownerSession.client.sync();
      const lookup = await ownerSession.client.recipientLookup(opts.ownerAddress);
      const entry = lookup?.entry;
      if (
        entry &&
        (entry.noteKey !== ownerKeys.notePublicKey ||
          entry.encryptionKey !== ownerKeys.encryptionPublicKey)
      ) {
        push(
          "On-chain registry keys differ from this browser’s SPP wallet — shielding with local keys so Private pay can see the notes.",
        );
      }
    } catch {
      /* registry lag is fine; we transfer by keys */
    }

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
      push(
        `Private transfer pass ${pass}: ${stroopsToXlm(shielded)} XLM → your Veilpay keys (inside pool)…`,
      );
      await transferToOwner(stealthSession.pool, ownerKeys, shielded);
      totalTransferred += shielded;
    }
  }

  if (totalDeposited <= 0n) {
    throw new Error(
      `Nothing deposited — stealth balance too low after fees (need ≥${MIN_SHIELD_BALANCE_XLM} XLM).`,
    );
  }

  push("Syncing your Freighter SPP notes…");
  const ownerBal = await readBalanceWithSync(ownerSession.client, ownerSession.pool);
  const leftoverXlm = await fetchXlmBalance(opts.stealthAddress);

  if (ownerBal === 0n && totalTransferred > 0n) {
    const stealthLeft = await readBalanceWithSync(stealthSession.client, stealthSession.pool, 2);
    if (stealthLeft > 0n) {
      push(`Retrying private transfer of remaining ${stroopsToXlm(stealthLeft)} XLM…`);
      await transferToOwner(stealthSession.pool, ownerKeys, stealthLeft);
      const again = await readBalanceWithSync(ownerSession.client, ownerSession.pool);
      if (again === 0n) {
        throw new Error(
          `Transferred on-chain but Private pay still reads 0. Try Stealth → Reclaim pool notes, or check the Nethermind SPP demo if you registered Freighter there first.`,
        );
      }
      return {
        depositedXlm: stroopsToXlm(totalDeposited),
        transferredXlm: stroopsToXlm(again),
        owner: opts.ownerAddress,
        stealthAddress: opts.stealthAddress,
        leftoverXlm,
      };
    }
    throw new Error(
      `On-chain shield submitted (${stroopsToXlm(totalTransferred)} XLM) but this browser’s pool is still 0. ` +
        `If you previously used the Nethermind SPP demo with the same Freighter, open that demo and Withdraw — notes may be encrypted to its keys.`,
    );
  }

  push(
    `Your SPP shielded balance is now ${stroopsToXlm(ownerBal)} XLM. Open Private pay → Withdraw to Freighter. ~${leftoverXlm.toFixed(2)} XLM remains on the burner.`,
  );

  return {
    depositedXlm: stroopsToXlm(totalDeposited),
    transferredXlm: stroopsToXlm(ownerBal > 0n ? ownerBal : totalTransferred),
    owner: opts.ownerAddress,
    stealthAddress: opts.stealthAddress,
    leftoverXlm,
  };
}

/**
 * Re-open a stealth burner in the pool and move any remaining notes to the
 * owner’s Veilpay privacy keys (transferToKeys). Use after a shield that
 * encrypted to stale registry keys, or if Private pay still shows 0.
 */
export async function reclaimStealthPoolNotes(opts: {
  stealthSecret: string;
  stealthAddress: string;
  ownerAddress: string;
  onProgress?: (msg: string) => void;
}): Promise<ShieldResult> {
  const push = opts.onProgress ?? (() => undefined);

  push("Loading your Freighter SPP keys…");
  const { session: ownerSession, keys: ownerKeys } = await ownerPrivacyKeys(opts.ownerAddress);

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
  const shielded = await readBalanceWithSync(stealthSession.client, stealthSession.pool);
  if (shielded <= 0n) {
    throw new Error(
      "No spendable notes left on this stealth burner. " +
        "They were already spent — if Private pay is still 0, open https://nethermindeth.github.io/stellar-private-payments/ with the same Freighter and check the balance there (registry-key mismatch).",
    );
  }

  push(`Moving ${stroopsToXlm(shielded)} XLM → your Veilpay keys…`);
  await transferToOwner(stealthSession.pool, ownerKeys, shielded);

  const ownerBal = await readBalanceWithSync(ownerSession.client, ownerSession.pool);
  const leftoverXlm = await fetchXlmBalance(opts.stealthAddress);
  if (ownerBal <= 0n) {
    throw new Error(
      "Reclaim transfer submitted but owner pool still reads 0 — sync may be lagging; hit Refresh on Private pay.",
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
