#!/usr/bin/env node
/**
 * Overlay Nethermind GH Pages SPP web SDK (circuits v0.7 + keyOwnership)
 * onto npm stellar-private-payments@0.2.1 and same-origin workers.
 *
 * npm 0.2.1 ships circuits v0.6; testnet registry expects the newer register
 * ABI. Without this overlay, registerPublicKeys fails with
 * HostError UnexpectedSize / MismatchingParameterLen.
 */
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GH =
  "https://nethermindeth.github.io/stellar-private-payments/js/stellar-private-payments";

const distFiles = [
  "dist/stellar_private_payments_web.js",
  "dist/stellar_private_payments_web_bg.wasm",
  "dist/stellar_private_payments_web.d.ts",
  "dist/stellar_private_payments_web_bg.wasm.d.ts",
  "js/index.js",
  "js/freighter.js",
];

const workerFiles = [
  "dist/workers/storage-worker.js",
  "dist/workers/storage-worker-module.js",
  "dist/workers/storage-worker-module_bg.wasm",
  "dist/workers/storage-worker-module.d.ts",
  "dist/workers/prover-worker.js",
  "dist/workers/prover-worker-module.js",
  "dist/workers/prover-worker-module_bg.wasm",
];

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  if (!res.body) throw new Error(`No body for ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function main() {
  const pkg = join(root, "node_modules", "stellar-private-payments");
  if (!existsSync(pkg)) {
    console.warn("[vendor-spp] stellar-private-payments missing — skip");
    return;
  }

  for (const rel of distFiles) {
    const dest = join(pkg, rel);
    process.stdout.write(`[vendor-spp] ${rel}… `);
    await download(`${GH}/${rel}`, dest);
    console.log("ok");
  }

  const workersDest = join(root, "public", "spp", "workers");
  for (const rel of workerFiles) {
    const name = rel.split("/").pop();
    const dest = join(workersDest, name);
    process.stdout.write(`[vendor-spp] workers/${name}… `);
    await download(`${GH}/${rel}`, dest);
    console.log("ok");
  }

  console.log("[vendor-spp] overlaid GH Pages SDK (circuits v0.7) onto npm package + public/spp/workers");
}

main().catch((e) => {
  console.error("[vendor-spp] failed:", e);
  process.exit(1);
});
