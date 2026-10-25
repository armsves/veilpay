/**
 * Deployed Veilpay confidential token (OZ stellar-confidential + SolvencyHooks).
 * Solvency (B/L ratio, atomic unbalance revert, panic) lives on the token itself —
 * not a separate vault.
 */

export const CONFIDENTIAL_TOKEN_ID =
  process.env.NEXT_PUBLIC_CONFIDENTIAL_TOKEN_ID ??
  "CBUOT3ETCV4R6AVGXBVNIWHWE64AWOH3GV53AEUGCTPBS73YIM7LFNE7";

export const CONFIDENTIAL_VERIFIER_ID =
  process.env.NEXT_PUBLIC_CONFIDENTIAL_VERIFIER_ID ??
  "CCTW4FGYDGE7EEIFAPRNPMZPZXZWU6A7FT5ZFUTNT2LUYKTBI6A6WVC4";

export const CONFIDENTIAL_AUDITOR_ID =
  process.env.NEXT_PUBLIC_CONFIDENTIAL_AUDITOR_ID ??
  "CASPCMOFIJCPSYLXR5CUOPMM5RKBUDK6UB5LH6RBCYLTFSHDDBCCI4MF";

/** Native XLM SAC on testnet — underlying for the confidential wrap. */
export const UNDERLYING_SAC_ID =
  process.env.NEXT_PUBLIC_UNDERLYING_SAC_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export function hasConfidentialToken(): boolean {
  return Boolean(CONFIDENTIAL_TOKEN_ID && CONFIDENTIAL_TOKEN_ID.startsWith("C"));
}
