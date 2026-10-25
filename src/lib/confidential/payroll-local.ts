/** Browser cache for payroll roster (server RAM resets on Vercel). */

const KEY = "veilpay-payroll-roster-v2";

export type LocalEmployee = {
  id: string;
  name: string;
  veilName?: string;
  /** Current one-time stealth pay address */
  stellarAddress: string;
  /** Freighter owner G… (SPP lookup) */
  ownerAddress?: string;
  confidentialBalanceUsdc?: string;
  lastSppPayXlm?: string;
};

export function loadLocalRoster(): LocalEmployee[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as LocalEmployee[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveLocalRoster(employees: LocalEmployee[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(employees));
}
