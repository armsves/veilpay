"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { WalletButton } from "./WalletButton";

const nav = [
  { href: "/app", label: "Overview" },
  { href: "/app/stealth", label: "Stealth" },
  { href: "/app/private-pay", label: "Private pay" },
  { href: "/app/payroll", label: "Payroll" },
  { href: "/app/confidential", label: "Confidential" },
  { href: "/app/cross-border", label: "Cross-border" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fillViewport = pathname === "/app/payroll" || pathname === "/app/cross-border";

  return (
    <div
      className={clsx(
        "veil-noise flex flex-col",
        fillViewport ? "h-dvh max-h-dvh overflow-hidden" : "min-h-dvh",
      )}
    >
      <header className="z-40 shrink-0 border-b border-[var(--line)] bg-[rgba(7,17,15,0.78)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="display text-lg tracking-tight sm:text-xl">
            Veil<span className="text-[var(--mint)]">pay</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-0.5">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "rounded-full px-2.5 py-1 text-sm transition sm:px-3.5 sm:py-1.5",
                    active
                      ? "bg-[var(--mint-dim)] text-[var(--mint)]"
                      : "text-[var(--cream-dim)] hover:text-[var(--cream)]",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2">
            <span className="pill pill-ok hidden lg:inline-flex">Testnet</span>
            <WalletButton compact />
          </div>
        </div>
      </header>
      <main
        className={clsx(
          "mx-auto w-full max-w-6xl px-5",
          fillViewport ? "flex min-h-0 flex-1 flex-col py-4" : "py-8",
        )}
      >
        {children}
      </main>
    </div>
  );
}
