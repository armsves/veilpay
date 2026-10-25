/**
 * Stellar Private Payments (Nethermind) — testnet deployment pointers.
 * Docs: https://developers.stellar.org/docs/build/apps/privacy
 * Demo: https://nethermindeth.github.io/stellar-private-payments/
 */

export const SPP_NPM = "stellar-private-payments@0.2.1";

/**
 * Circuit + worker artifacts.
 * jsDelivr returns 403 for this package (too large for their npm CDN).
 * Nethermind hosts the same dist/ on the official demo’s GitHub Pages.
 */
export const SPP_ASSET_ORIGIN =
  "https://nethermindeth.github.io/stellar-private-payments/js/stellar-private-payments/dist";

export const sppAssetUrls = {
  circuitsBaseUrl: `${SPP_ASSET_ORIGIN}/circuits/`,
  circuitsLockUrl: `${SPP_ASSET_ORIGIN}/circuits/circuits.json`,
  storageWorkerUrl: `${SPP_ASSET_ORIGIN}/workers/storage-worker.js`,
  proverWorkerUrl: `${SPP_ASSET_ORIGIN}/workers/prover-worker.js`,
  deploymentsUrl: "/spp-deployments.json",
} as const;

/**
 * Public archive used by the official SPP demo when Soroban RPC’s ~7-day
 * event window isn’t enough. From nethermindeth.github.io/stellar-private-payments
 * (default `https://bootnode.dev-nethermind.xyz`). Self-host via their bootnode
 * tool if you don’t want to trust this endpoint.
 */
export const SPP_DEFAULT_BOOTNODE_URL = "https://bootnode.dev-nethermind.xyz";

/** Native XLM pool without GVK (simplest testnet path). */
export const SPP_XLM_POOL_ID =
  "CAALK4NV2DP4H4OWCILGZZJQ27TV53RBDRFENSHEZTRFNSBDY3KG6SUP";

export const sppDocs = {
  stellarPrivacy: "https://developers.stellar.org/docs/build/apps/privacy",
  demo: "https://nethermindeth.github.io/stellar-private-payments/",
  repo: "https://github.com/NethermindEth/stellar-private-payments",
  npm: "https://www.npmjs.com/package/stellar-private-payments",
} as const;
