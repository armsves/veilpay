import Link from "next/link";
import { WalletButton } from "@/components/WalletButton";

export default function HomePage() {
  return (
    <div className="relative flex h-dvh max-h-dvh flex-col overflow-hidden veil-noise">
      <div className="pointer-events-none absolute inset-0 veil-grid opacity-70" />
      <div
        className="pointer-events-none absolute -right-24 top-1/4 h-[55vh] w-[55vh] rounded-full opacity-40"
        style={{
          background:
            "radial-gradient(circle, rgba(61,186,140,0.28) 0%, transparent 68%)",
          animation: "pulse-soft 5s ease-in-out infinite",
        }}
        aria-hidden
      />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-5 py-4 sm:py-5">
        <div className="display text-xl tracking-tight sm:text-2xl">
          Veil<span className="text-[var(--mint)]">pay</span>
        </div>
        <div className="flex items-center gap-3">
          <WalletButton compact />
          <Link href="/app" className="btn btn-ghost hidden text-sm !py-1.5 !px-3 sm:inline-flex">
            App
          </Link>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 pb-8 pt-2">
        <h1 className="display animate-rise max-w-4xl text-[clamp(2.75rem,12vw,5.5rem)] leading-[0.98] tracking-tight">
          Veil<span className="text-[var(--mint)]">pay</span>
        </h1>
        <p className="animate-rise-delay mt-4 max-w-md text-base text-[var(--cream-dim)] sm:mt-5 sm:text-lg">
          Private payroll on Stellar — stealth receives, confidential amounts, Pollar Sandbox cash-out.
        </p>
        <div className="animate-rise-delay-2 mt-7 flex flex-wrap gap-3 sm:mt-8">
          <Link href="/app" className="btn btn-primary">
            Enter Veilpay
          </Link>
          <Link href="/app/payroll" className="btn btn-ghost">
            Payroll demo
          </Link>
        </div>
      </section>
    </div>
  );
}
