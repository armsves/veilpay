/**
 * Pool solvency guard — ratio monitor + unbalance revert + panic halt.
 * Designed to sit beside OZ stellar-confidential (v0.8.0) on testnet.
 *
 * Layers:
 * 1) Gate: reject deposit/withdraw that would leave B < L
 * 2) Monitor: detect B < L after external drains
 * 3) Panic halt: freeze all pool ops until governance rescue
 */

export type SolvencySnapshot = {
  assets: bigint; // B — underlying USDC held by pool
  liabilities: bigint; // L — sum of public deposit − withdraw − clawback
  coverage: number; // B / L (Infinity if L=0)
  panicHalt: boolean;
  minCoverage: number;
  updatedAt: number;
};

export type SolvencyEvent =
  | { type: "deposit"; amount: bigint }
  | { type: "withdraw"; amount: bigint }
  | { type: "clawback"; amount: bigint }
  | { type: "external_asset_delta"; delta: bigint } // e.g. simulated SAC clawback
  | { type: "panic_halt"; reason: string }
  | { type: "unpause"; reason: string };

export class SolvencyError extends Error {
  constructor(
    message: string,
    public code: "INSOLVENT" | "PANIC" | "WOULD_UNBALANCE" | "INSUFFICIENT_ASSETS",
  ) {
    super(message);
    this.name = "SolvencyError";
  }
}

export class SolvencyGuard {
  private assets: bigint;
  private liabilities: bigint;
  private panicHalt = false;
  private readonly minCoverage: number;
  private log: Array<{ at: number; event: SolvencyEvent; snapshot: SolvencySnapshot }> = [];

  constructor(opts?: { assets?: bigint; liabilities?: bigint; minCoverage?: number }) {
    this.assets = opts?.assets ?? 0n;
    this.liabilities = opts?.liabilities ?? 0n;
    this.minCoverage = opts?.minCoverage ?? 1;
  }

  snapshot(): SolvencySnapshot {
    const coverage =
      this.liabilities === 0n
        ? Number.POSITIVE_INFINITY
        : Number(this.assets) / Number(this.liabilities);
    return {
      assets: this.assets,
      liabilities: this.liabilities,
      coverage,
      panicHalt: this.panicHalt,
      minCoverage: this.minCoverage,
      updatedAt: Date.now(),
    };
  }

  private assertNotHalted() {
    if (this.panicHalt) {
      throw new SolvencyError("Pool is panic-halted", "PANIC");
    }
  }

  private assertSolvent(label: string) {
    const s = this.snapshot();
    if (s.liabilities > 0n && s.coverage < this.minCoverage) {
      throw new SolvencyError(
        `${label}: coverage ${(s.coverage * 100).toFixed(4)}% below min ${(this.minCoverage * 100).toFixed(2)}%`,
        "INSOLVENT",
      );
    }
  }

  /** Anyone can call when insolvent — permissionless circuit breaker. */
  haltIfInsolvent(reason = "coverage below minimum"): SolvencySnapshot {
    const s = this.snapshot();
    if (s.liabilities > 0n && s.coverage < this.minCoverage) {
      this.panicHalt = true;
      this.push({ type: "panic_halt", reason });
    }
    return this.snapshot();
  }

  forcePanic(reason: string) {
    this.panicHalt = true;
    this.push({ type: "panic_halt", reason });
    return this.snapshot();
  }

  unpause(reason: string) {
    this.assertSolvent("unpause");
    this.panicHalt = false;
    this.push({ type: "unpause", reason });
    return this.snapshot();
  }

  /**
   * Governance rescue while halted: top up assets only (no new liabilities).
   * Call unpause once coverage ≥ min.
   */
  rescueDeposit(amount: bigint): SolvencySnapshot {
    if (amount <= 0n) throw new Error("amount must be positive");
    this.assets += amount;
    this.push({ type: "deposit", amount });
    return this.snapshot();
  }

  /**
   * Deposit USDC into confidential pool.
   * Reverts if already insolvent or halted.
   */
  deposit(amount: bigint): SolvencySnapshot {
    if (amount <= 0n) throw new Error("amount must be positive");
    this.assertNotHalted();
    this.assertSolvent("deposit");
    this.assets += amount;
    this.liabilities += amount;
    this.assertSolvent("deposit-post");
    this.push({ type: "deposit", amount });
    return this.snapshot();
  }

  /**
   * Withdraw / unwrap. Reverts if the tx would leave B < L
   * or if pool is already insolvent / halted.
   */
  withdraw(amount: bigint): SolvencySnapshot {
    if (amount <= 0n) throw new Error("amount must be positive");
    this.assertNotHalted();
    this.assertSolvent("withdraw");
    if (this.assets < amount) {
      throw new SolvencyError("Insufficient pool assets", "INSUFFICIENT_ASSETS");
    }
    const nextB = this.assets - amount;
    const nextL = this.liabilities - amount;
    if (nextL > 0n && Number(nextB) / Number(nextL) < this.minCoverage) {
      throw new SolvencyError("Withdraw would unbalance coverage", "WOULD_UNBALANCE");
    }
    this.assets = nextB;
    this.liabilities = nextL;
    this.push({ type: "withdraw", amount });
    return this.snapshot();
  }

  /** Compliance clawback that reduces both B and L together. */
  clawback(amount: bigint): SolvencySnapshot {
    this.assertNotHalted();
    if (amount > this.assets || amount > this.liabilities) {
      throw new SolvencyError("Clawback exceeds pool", "INSUFFICIENT_ASSETS");
    }
    this.assets -= amount;
    this.liabilities -= amount;
    this.push({ type: "clawback", amount });
    return this.snapshot();
  }

  /**
   * Simulate external drain (SAC clawback of pool address).
   * Monitor should call haltIfInsolvent afterwards.
   */
  applyExternalAssetDelta(delta: bigint): SolvencySnapshot {
    this.assets += delta;
    if (this.assets < 0n) this.assets = 0n;
    this.push({ type: "external_asset_delta", delta });
    return this.haltIfInsolvent("external asset delta");
  }

  history() {
    return [...this.log];
  }

  private push(event: SolvencyEvent) {
    this.log.push({ at: Date.now(), event, snapshot: this.snapshot() });
  }
}

/** Format stroops-like i128 as decimal USDC (7 decimals on Stellar). */
export function formatUsdc(stroops: bigint, decimals = 7): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function parseUsdc(amount: string, decimals = 7): bigint {
  const [w, f = ""] = amount.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}
