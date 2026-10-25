import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Confidential proving needs SharedArrayBuffer → cross-origin isolation.
 * Scope to /app/confidential (+ static /bb assets) so the rest of the app
 * keeps normal Freighter / embed behavior.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;
  if (path.startsWith("/app/confidential") || path.startsWith("/bb/")) {
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    res.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  }
  return res;
}

export const config = {
  matcher: ["/app/confidential/:path*", "/bb/:path*"],
};
