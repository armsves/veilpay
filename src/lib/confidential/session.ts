/**
 * Browser session for Veilpay confidential token (OZ SDK + Freighter).
 */
import { signMessage, signTransaction } from "@stellar/freighter-api";
import {
  CONFIDENTIAL_AUDITOR_ID,
  CONFIDENTIAL_TOKEN_ID,
  CONFIDENTIAL_VERIFIER_ID,
} from "./config";
import { installBbLoader, isCrossOriginIsolated } from "./bb-loader";

const PASSPHRASE = "Test SDF Network ; September 2015";
const RPC = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const AUDITOR_ID = 0;
/** At-or-before first register/deposit — must not be "now" or openings are lost. */
const GENESIS_LEDGER = Number(process.env.NEXT_PUBLIC_CONFIDENTIAL_GENESIS_LEDGER ?? "5391700");

export type ConfidentialSession = {
  address: string;
  client: import("stellar-confidential-token-sdk").ChainClient;
  keys: import("stellar-confidential-token-sdk").KeyPair;
  signer: import("stellar-confidential-token-sdk").Signer;
  engine: import("stellar-confidential-token-sdk").StateEngine;
  registerProver: import("stellar-confidential-token-sdk").CircuitProver;
  withdrawProver: import("stellar-confidential-token-sdk").CircuitProver;
  transferProver: import("stellar-confidential-token-sdk").CircuitProver;
};

function freighterSigner(address: string): import("stellar-confidential-token-sdk").Signer {
  return {
    publicKey: address,
    async sign(txXdrBase64: string) {
      const result = await signTransaction(txXdrBase64, {
        networkPassphrase: PASSPHRASE,
        address,
      });
      if (result.error || !result.signedTxXdr) {
        throw new Error(result.error?.message ?? "Freighter refused to sign");
      }
      return result.signedTxXdr;
    },
  };
}

/** Obtain SEP-53 signer root via Freighter (never persisted). */
async function freighterRoot(address: string): Promise<Uint8Array> {
  const { skSigningMessage } = await import("stellar-confidential-token-sdk");
  const msgBytes = skSigningMessage(CONFIDENTIAL_TOKEN_ID, address);
  const msg = new TextDecoder().decode(msgBytes);
  const result = await signMessage(msg, {
    networkPassphrase: PASSPHRASE,
    address,
  });
  if (result.error || result.signedMessage == null) {
    throw new Error(result.error?.message ?? "Freighter signMessage failed");
  }
  const signed = result.signedMessage;
  if (typeof signed === "string") {
    const bin = atob(signed);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(signed);
}

function fromLedgerKey(address: string) {
  return `veilpay-ct-from:${CONFIDENTIAL_TOKEN_ID}:${address}`;
}

function resolveFromLedger(address: string): number {
  if (typeof localStorage === "undefined") return GENESIS_LEDGER;
  const raw = localStorage.getItem(fromLedgerKey(address));
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return Math.min(n, GENESIS_LEDGER);
  localStorage.setItem(fromLedgerKey(address), String(GENESIS_LEDGER));
  return GENESIS_LEDGER;
}

function makeClient() {
  return import("stellar-confidential-token-sdk").then((sdk) => {
    return new sdk.ChainClient({
      rpcUrl: RPC,
      networkPassphrase: PASSPHRASE,
      contracts: {
        token: CONFIDENTIAL_TOKEN_ID,
        verifier: CONFIDENTIAL_VERIFIER_ID,
        auditor: CONFIDENTIAL_AUDITOR_ID,
      },
    });
  });
}

let cached: ConfidentialSession | null = null;

export async function openConfidentialSession(address: string): Promise<ConfidentialSession> {
  if (cached && cached.address === address) return cached;
  if (!isCrossOriginIsolated()) {
    throw new Error(
      "Page is not cross-origin isolated (need COOP/COEP). Hard-refresh /app/confidential.",
    );
  }

  await installBbLoader();

  const sdk = await import("stellar-confidential-token-sdk");
  const [registerArtifact, withdrawArtifact, transferArtifact] = await Promise.all([
    import("./circuits/register.json"),
    import("./circuits/withdraw.json"),
    import("./circuits/transfer.json"),
  ]);

  const client = new sdk.ChainClient({
    rpcUrl: RPC,
    networkPassphrase: PASSPHRASE,
    contracts: {
      token: CONFIDENTIAL_TOKEN_ID,
      verifier: CONFIDENTIAL_VERIFIER_ID,
      auditor: CONFIDENTIAL_AUDITOR_ID,
    },
  });

  const root = await freighterRoot(address);
  const d = sdk.deriveSk(root, CONFIDENTIAL_TOKEN_ID, address);
  const keys = sdk.deriveKeys(d.sk, d.addrF);
  const fromLedger = resolveFromLedger(address);
  const store = new sdk.LocalStorageStore(`veilpay-ct:${CONFIDENTIAL_TOKEN_ID}:`);
  const engine = new sdk.StateEngine({
    client,
    store,
    keys,
    address,
    fromLedger,
  });
  try {
    await engine.sync();
  } catch {
    // First visit / empty history is fine
  }

  cached = {
    address,
    client,
    keys,
    signer: freighterSigner(address),
    engine,
    registerProver: sdk.proverFromArtifact(registerArtifact.default),
    withdrawProver: sdk.proverFromArtifact(withdrawArtifact.default),
    transferProver: sdk.proverFromArtifact(transferArtifact.default),
  };
  return cached;
}

export function clearConfidentialSession() {
  cached = null;
}

export async function registerAccount(session: ConfidentialSession): Promise<string> {
  const { buildRegisterWitness, submitRegister } = await import("stellar-confidential-token-sdk");
  const rw = buildRegisterWitness(session.keys, session.address);
  const { proof } = await session.registerProver.prove(rw.inputs);
  const res = await submitRegister(
    session.client,
    session.signer,
    session.address,
    AUDITOR_ID,
    rw,
    proof,
  );
  try {
    await session.engine.sync();
  } catch {
    /* ignore */
  }
  return res.hash;
}

export async function depositNative(
  session: ConfidentialSession,
  amountStroops: bigint,
): Promise<string> {
  const { submitDeposit } = await import("stellar-confidential-token-sdk");
  const res = await submitDeposit(
    session.client,
    session.signer,
    session.address,
    session.address,
    amountStroops,
  );
  return res.hash;
}

export async function mergeReceiving(session: ConfidentialSession): Promise<string> {
  const { submitMerge } = await import("stellar-confidential-token-sdk");
  const res = await submitMerge(session.client, session.signer, session.address);
  try {
    await session.engine.sync();
  } catch {
    /* ignore */
  }
  return res.hash;
}

/**
 * If local receiving > 0 after sync, fold it into spendable.
 * Returns the merge tx hash, or null when there was nothing to merge.
 */
export async function mergeReceivingIfNeeded(
  session: ConfidentialSession,
): Promise<{ hash: string; amount: bigint } | null> {
  const bal = await localBalances(session);
  const receiving = bal?.receiving ?? 0n;
  if (receiving <= 0n) return null;
  const hash = await mergeReceiving(session);
  return { hash, amount: receiving };
}

/** Confidential → public SEP-41 (native). Solvency Hooks gate this on-chain. */
export async function withdrawNative(
  session: ConfidentialSession,
  amountStroops: bigint,
  toAddress?: string,
): Promise<string> {
  const { buildWithdrawWitness, submitWithdraw } = await import("stellar-confidential-token-sdk");
  try {
    await session.engine.sync();
  } catch (e) {
    throw new Error(
      `Could not sync confidential openings: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const { v, r } = await session.engine.spendableForProof();
  if (amountStroops <= 0n || amountStroops > v) {
    throw new Error(
      `Amount must be between 1 and spendable (${formatXlm(v)} XLM). Deposit+Merge first.`,
    );
  }
  const acct = await session.client.confidentialBalance(session.address);
  if (!acct) throw new Error("Account not registered");
  const kAudS = await session.client.auditorKey(acct.auditorId);
  const ww = buildWithdrawWitness({
    keys: session.keys,
    v,
    r,
    amount: amountStroops,
    kAudS,
  });
  const { proof } = await session.withdrawProver.prove(ww.inputs);
  const to = toAddress?.trim() || session.address;
  const res = await submitWithdraw(
    session.client,
    session.signer,
    session.address,
    to,
    amountStroops,
    ww,
    proof,
  );
  try {
    await session.engine.sync();
  } catch {
    /* ignore */
  }
  return res.hash;
}

/** Confidential → confidential. Recipient must already be registered. */
export async function confidentialTransfer(
  session: ConfidentialSession,
  toAddress: string,
  amountStroops: bigint,
): Promise<string> {
  const to = toAddress.trim();
  if (!to.startsWith("G") || to.length < 56) {
    throw new Error("Recipient must be a registered G… address");
  }
  const { buildTransferWitness, submitTransfer } = await import("stellar-confidential-token-sdk");
  try {
    await session.engine.sync();
  } catch (e) {
    throw new Error(
      `Could not sync confidential openings: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const { v, r } = await session.engine.spendableForProof();
  if (amountStroops <= 0n || amountStroops > v) {
    throw new Error(
      `Amount must be between 1 and spendable (${formatXlm(v)} XLM). Deposit+Merge first.`,
    );
  }
  const [sender, recipient] = await Promise.all([
    session.client.confidentialBalance(session.address),
    session.client.confidentialBalance(to),
  ]);
  if (!sender) throw new Error("Your account is not registered");
  if (!recipient) {
    throw new Error("Recipient is not registered — they must Register first");
  }
  const [kAudR, kAudS] = await Promise.all([
    session.client.auditorKey(recipient.auditorId),
    session.client.auditorKey(sender.auditorId),
  ]);
  const tw = buildTransferWitness({
    keys: session.keys,
    v,
    r,
    amount: amountStroops,
    pvkB: recipient.viewingPublicKey,
    kAudR,
    kAudS,
  });
  const { proof } = await session.transferProver.prove(tw.inputs);
  const res = await submitTransfer(session.client, session.signer, session.address, to, tw, proof);
  try {
    await session.engine.sync();
  } catch {
    /* ignore */
  }
  return res.hash;
}

/** Read-only — no Freighter. */
export async function readSolvency() {
  const { Client, networks } = await import("./token-bindings");
  const c = new Client({
    contractId: CONFIDENTIAL_TOKEN_ID,
    networkPassphrase: networks.testnet.networkPassphrase,
    rpcUrl: RPC,
  });
  const tx = await c.solvency();
  return tx.result;
}

/** Read-only registration check — no Freighter. */
export async function checkRegistered(address: string): Promise<boolean> {
  try {
    const client = await makeClient();
    const acct = await client.confidentialBalance(address);
    // confidentialBalance returns null when unregistered (does not throw).
    return acct !== null;
  } catch {
    return false;
  }
}

export async function isRegistered(session: ConfidentialSession): Promise<boolean> {
  return checkRegistered(session.address);
}

/** Local openings after sync (stroops). */
export async function localBalances(session: ConfidentialSession): Promise<{
  spendable: bigint;
  receiving: bigint;
} | null> {
  try {
    const s = await session.engine.sync();
    return {
      spendable: s.spendable?.v ?? 0n,
      receiving: s.receiving?.v ?? 0n,
    };
  } catch {
    return null;
  }
}

export function formatXlm(stroops: bigint | string | number): string {
  const n = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  const neg = n < 0n;
  const v = neg ? -n : n;
  const whole = v / 10_000_000n;
  const frac = (v % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function parseXlm(amount: string): bigint {
  const [w, f = ""] = amount.trim().split(".");
  const frac = (f + "0000000").slice(0, 7);
  return BigInt(w || "0") * 10_000_000n + BigInt(frac || "0");
}

export { CONFIDENTIAL_TOKEN_ID, AUDITOR_ID, GENESIS_LEDGER };
