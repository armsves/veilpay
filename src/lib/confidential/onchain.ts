import { CONFIDENTIAL_TOKEN_ID } from "./config";

const RPC = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

/** Read solvency view from the deployed confidential token (no wallet). */
export async function fetchOnchainSolvency(): Promise<{
  assets: string;
  liabilities: string;
  coverage_bps: number;
  panic_halt: boolean;
  min_coverage_bps: number;
  tokenId: string;
} | null> {
  try {
    const { Client, networks } = await import("./token-bindings");
    const client = new Client({
      contractId: CONFIDENTIAL_TOKEN_ID,
      networkPassphrase: networks.testnet.networkPassphrase,
      rpcUrl: RPC,
    });
    const tx = await client.solvency();
    const v = tx.result;
    return {
      assets: v.assets.toString(),
      liabilities: v.liabilities.toString(),
      coverage_bps: v.coverage_bps,
      panic_halt: v.panic_halt,
      min_coverage_bps: v.min_coverage_bps,
      tokenId: CONFIDENTIAL_TOKEN_ID,
    };
  } catch {
    return null;
  }
}
