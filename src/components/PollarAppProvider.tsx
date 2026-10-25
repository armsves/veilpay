"use client";

import { PollarProvider } from "@pollar/react";
import "@pollar/react/styles.css";
import { useEffect, useState, type ReactNode } from "react";

const apiKey = process.env.NEXT_PUBLIC_POLLAR_KEY?.trim() ?? "";

export function PollarAppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!apiKey || !ready) return <>{children}</>;

  return (
    <PollarProvider
      client={{
        apiKey,
        stellarNetwork: "testnet",
      }}
    >
      {children}
    </PollarProvider>
  );
}
