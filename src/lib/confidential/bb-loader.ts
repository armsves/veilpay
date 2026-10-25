/**
 * Load UltraHonk from a stable public path so bb.js workers resolve.
 * Must run in the browser before any CircuitProver.prove().
 */
export async function installBbLoader(): Promise<void> {
  const { setUltraHonkBackendLoader } = await import("stellar-confidential-token-sdk");
  setUltraHonkBackendLoader(async () => {
    // Native ESM from /public/bb — not bundler-chunked (url must stay absolute)
    const url = "/bb/index.js";
    const mod = (await import(/* webpackIgnore: true */ url)) as {
      UltraHonkBackend: new (bytecode: string, options?: { threads?: number }) => unknown;
    };
    return mod.UltraHonkBackend as never;
  });
}

export function isCrossOriginIsolated(): boolean {
  return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
}
