/**
 * Browser mirror of your .veil registration.
 * Vercel serverless only keeps VNS in /tmp + RAM, so refreshes/cold starts
 * drop server state — we re-POST register from this cache on load.
 */

const KEY = "veilpay-vns-registration-v1";

export type LocalVeilRegistration = {
  name: string;
  fqdn: string;
  owner: string;
  savedAt: number;
};

export function loadLocalVeilRegistration(owner: string): LocalVeilRegistration | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LocalVeilRegistration;
    if (!data?.name || !data?.owner || data.owner !== owner) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveLocalVeilRegistration(opts: {
  name: string;
  fqdn: string;
  owner: string;
}) {
  if (typeof window === "undefined") return;
  const payload: LocalVeilRegistration = {
    name: opts.name,
    fqdn: opts.fqdn,
    owner: opts.owner,
    savedAt: Date.now(),
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

export function clearLocalVeilRegistration() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
