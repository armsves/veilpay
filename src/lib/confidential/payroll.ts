/**
 * Confidential payroll on Stellar testnet.
 * Wraps OZ stellar-confidential semantics + Veilpay solvency guard.
 *
 * Flow: employer deposits USDC → confidential credit → pay employees
 * (amounts hidden, addresses visible) → employee unwrap → Pollar Sandbox offramp.
 */

import { SolvencyGuard, formatUsdc, parseUsdc, type SolvencySnapshot } from "./solvency";
import { planConfidentialOfframp } from "../pollar/client";

export type Employee = {
  id: string;
  name: string;
  stellarAddress: string;
  stealthMeta?: string;
  confidentialBalance: bigint; // demo ledger (not Pedersen — SDK proves on-chain)
};

export type PayrollRun = {
  id: string;
  createdAt: number;
  items: Array<{ employeeId: string; amount: bigint; status: "queued" | "paid" | "failed" }>;
};

/** In-memory demo store — replace with indexer + OZ SDK for production. */
export class ConfidentialPayrollService {
  readonly solvency: SolvencyGuard;
  employees: Employee[] = [];
  runs: PayrollRun[] = [];

  constructor() {
    this.solvency = new SolvencyGuard({ minCoverage: 1 });
  }

  fundTreasury(usdcAmount: string): SolvencySnapshot {
    return this.solvency.deposit(parseUsdc(usdcAmount));
  }

  addEmployee(input: Omit<Employee, "id" | "confidentialBalance">) {
    const emp: Employee = {
      ...input,
      id: `emp_${Math.random().toString(36).slice(2, 9)}`,
      confidentialBalance: 0n,
    };
    this.employees.push(emp);
    return emp;
  }

  /**
   * Confidential pay: pool liabilities already include treasury deposits.
   * Transfer moves private claim employer→employee without changing B/L.
   */
  payEmployee(employeeId: string, usdcAmount: string) {
    this.solvency.haltIfInsolvent();
    if (this.solvency.snapshot().panicHalt) {
      throw new Error("Pool panic-halted — payroll frozen");
    }
    const amount = parseUsdc(usdcAmount);
    const emp = this.employees.find((e) => e.id === employeeId);
    if (!emp) throw new Error("Employee not found");
    // In real OZ flow this is a confidential_transfer with UltraHonk proof.
    emp.confidentialBalance += amount;
    return {
      employeeId,
      amount: formatUsdc(amount),
      confidentialBalance: formatUsdc(emp.confidentialBalance),
      note: "Confidential transfer (demo ledger). On-chain: stellar-confidential transfer circuit.",
    };
  }

  runPayroll(payments: Array<{ employeeId: string; amount: string }>) {
    const run: PayrollRun = {
      id: `run_${Date.now()}`,
      createdAt: Date.now(),
      items: [],
    };
    for (const p of payments) {
      try {
        this.payEmployee(p.employeeId, p.amount);
        run.items.push({
          employeeId: p.employeeId,
          amount: parseUsdc(p.amount),
          status: "paid",
        });
      } catch {
        run.items.push({
          employeeId: p.employeeId,
          amount: parseUsdc(p.amount),
          status: "failed",
        });
      }
    }
    this.runs.unshift(run);
    return run;
  }

  /** Employee cash-out: solvency-gated unwrap then Pollar Sandbox. */
  prepareOfframp(employeeId: string, usdcAmount: string, fiat: "ARS" | "PEN") {
    const emp = this.employees.find((e) => e.id === employeeId);
    if (!emp) throw new Error("Employee not found");
    const amount = parseUsdc(usdcAmount);
    if (emp.confidentialBalance < amount) throw new Error("Insufficient confidential balance");

    // Solvency gate on unwrap (would-unbalance / panic)
    this.solvency.withdraw(amount);
    emp.confidentialBalance -= amount;

    const plan = planConfidentialOfframp({
      fiat,
      amountLabel: `${formatUsdc(amount)} USDC`,
    });

    return {
      employee: emp,
      unwrapped: formatUsdc(amount),
      solvency: this.solvency.snapshot(),
      pollar: plan,
    };
  }

  coverage() {
    return this.solvency.snapshot();
  }
}

/** Singleton for API routes / demo UI */
const globalStore = globalThis as unknown as {
  __veilpayPayroll?: ConfidentialPayrollService;
};

export function getPayrollService() {
  if (!globalStore.__veilpayPayroll) {
    globalStore.__veilpayPayroll = new ConfidentialPayrollService();
  }
  return globalStore.__veilpayPayroll;
}
