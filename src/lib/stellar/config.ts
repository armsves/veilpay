export type NetworkMode = "testnet" | "mainnet";

export const networkMode: NetworkMode =
  process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const stellar = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    /** Stellar RPC (Horizon is EOL — do not use for apps) */
    rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    /** Circle testnet USDC */
    usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    friendbot: "https://friendbot.stellar.org",
  },
  mainnet: {
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://mainnet.sorobanrpc.com",
    usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  },
} as const;

export function currentNetwork() {
  return stellar[networkMode];
}

/** Pointers to Stellar privacy stack (developers.stellar.org/docs/build/apps/privacy) */
export const privacyStack = {
  sppDemo: "https://nethermindeth.github.io/stellar-private-payments",
  sppRepo: "https://github.com/NethermindEth/stellar-private-payments",
  sppNpm: "stellar-private-payments",
  confidentialDocs: "https://docs.openzeppelin.com/stellar-contracts/tokens/confidential/confidential",
  confidentialCrate: "stellar-confidential@0.8.0",
  privacyDocs: "https://developers.stellar.org/docs/build/apps/privacy",
} as const;
