/**
 * Veilpay SolvencyHooks used to publish `deposit` / `withdraw` diagnostic
 * events with Vec payloads. The confidential-token SDK's parseEvent assumes
 * every KNOWN-named event is an ScMap and throws "map not set" on Vec —
 * which aborts sync before the real protocol deposit/merge openings apply.
 *
 * Skip non-map payloads so historical Vec diagnostics are ignored.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eventsPath = join(
  root,
  "node_modules/stellar-confidential-token-sdk/dist/chain/events.js",
);
if (!existsSync(eventsPath)) {
  console.warn("[patch-ct-events] SDK not installed — skip");
  process.exit(0);
}

const MARKER = "/* veilpay:skip-non-map-events */";
const src = readFileSync(eventsPath, "utf8");
if (src.includes(MARKER)) {
  console.log("[patch-ct-events] already applied");
  process.exit(0);
}

const needle = `    const addr = (i) => Address.fromScVal(topics[i]).toString();
    return buildConfidentialEvent(name, base, addr, dataMap(ev.value));
}`;

const insert = `    const addr = (i) => Address.fromScVal(topics[i]).toString();
    ${MARKER}
    // Non-map payloads (Veilpay solvency Vec diagnostics that reused protocol
    // event names) must not abort sync — skip them.
    try {
        if (ev.value.switch().name !== "scvMap")
            return null;
    }
    catch {
        return null;
    }
    return buildConfidentialEvent(name, base, addr, dataMap(ev.value));
}`;

if (!src.includes(needle)) {
  console.error("[patch-ct-events] parseEvent shape changed — update scripts/patch-ct-events.mjs");
  process.exit(1);
}

writeFileSync(eventsPath, src.replace(needle, insert));
console.log("[patch-ct-events] patched", eventsPath.replace(root + "/", ""));
