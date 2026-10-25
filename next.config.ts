import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // SPP is client-only (dynamic import); keep it external to the server graph.
  serverExternalPackages: ["stellar-private-payments"],
};

export default nextConfig;
