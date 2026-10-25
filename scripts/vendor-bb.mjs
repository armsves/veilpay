#!/usr/bin/env node
/**
 * Copy @aztec/bb.js browser build into public/bb for native ESM + workers.
 * Runs on Vercel install/build so we don't commit ~7MB binaries.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@aztec", "bb.js", "dest", "browser");
const dest = join(root, "public", "bb");

if (!existsSync(src)) {
  console.warn("[vendor-bb] @aztec/bb.js browser build missing — skip");
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[vendor-bb] copied", src, "→", dest);
