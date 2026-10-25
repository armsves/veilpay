/**
 * Stellar Private Payments (Nethermind) — testnet deployment pointers.
 * Docs: https://developers.stellar.org/docs/build/apps/privacy
 * Demo: https://nethermindeth.github.io/stellar-private-payments/
 */

export const SPP_NPM = "stellar-private-payments@0.2.1";

/**
 * Circuits must match the installed SDK (0.2.1 → circuits lock v0.6).
 * GH Pages currently ships v0.7 which breaks registerPublicKeys
 * (HostError UnexpectedSize / MismatchingParameterLen on registry.register).
 * unpkg serves the npm package; jsDelivr 403s the oversized tarball.
 * Workers: same-origin under /spp/workers — cross-origin Worker() panics.
 */
export const SPP_CIRCUITS_ORIGIN =
  "https://unpkg.com/stellar-private-payments@0.2.1/dist";

export const sppAssetUrls = {
  circuitsBaseUrl: `${SPP_CIRCUITS_ORIGIN}/circuits/`,
  circuitsLockUrl: `${SPP_CIRCUITS_ORIGIN}/circuits/circuits.json`,
  /** Same-origin module workers (cross-origin Worker() panics in gloo-worker). */
  storageWorkerUrl: "/spp/workers/storage-worker.js",
  proverWorkerUrl: "/spp/workers/prover-worker.js",
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
