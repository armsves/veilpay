import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // SPP / OZ confidential SDK are client-only; keep out of the server graph.
  serverExternalPackages: [
    "stellar-private-payments",
    "stellar-confidential-token-sdk",
    "@aztec/bb.js",
    "@noir-lang/noir_js",
  ],
};

export default nextConfig;
