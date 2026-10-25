# Veilpay

Private payroll banking app on Stellar — stealth addresses, confidential amounts, solvency-guarded pools, and Pollar Sandbox cross-border ramps.

## Modules (separate)

| Module | Path | Network |
|--------|------|---------|
| Stealth testnet | `src/lib/stealth/testnet.ts` | Stellar testnet (DKSAP-style + [privacy docs](https://developers.stellar.org/docs/build/apps/privacy) / SPP) |
| Veilpay Name Service | `src/lib/stealth/nameservice.ts` | Fluidkey-style `name.veil` → fresh stealth address on every resolve |
| Stellar Private Payments | `src/lib/spp/*` | Nethermind SPP testnet pools (deposit / private transfer / withdraw) |
| Stealth mainnet + Intents | `src/lib/stealth/mainnet-intents.ts` | Mainnet path via Aurora Confidential Intents |
| Confidential payroll + solvency | `src/lib/confidential/*` | Testnet — B≥L gate, monitor halt, panic lock |
| Pollar Sandbox ramps | `src/lib/pollar/client.ts` | TestNet SEP-24 ARS/PEN — **no mock bank** |

## Quick start

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Connect with **Freighter** (Testnet).

Optional env:

- `NEXT_PUBLIC_POLLAR_KEY` — Pollar publishable key (TestNet app with **Pollar Sandbox** enabled)
- `AURORA_INTENTS_API_KEY` — Aurora Intents partner key (server-only, mainnet confidential quotes)

## Wallet

Freighter via `@stellar/freighter-api`: connect in the header, restore session, network mismatch warning (expects Testnet), and `signXdr` helper for future Soroban txs.

## App routes

- `/` — brand landing
- `/app` — banking overview
- `/app/stealth` — register `you.veil`, resolve stealth addresses, Aurora XLM
- `/app/private-pay` — SPP privacy pool (official Stellar privacy docs path)
- `/pay/[name]` — public Fluidkey-style pay page (fresh address each load)
- `/app/payroll` — fund / pay / drain simulation / panic / unwrap→Pollar
- `/app/cross-border` — Pollar Sandbox corridors

## Solvency model

1. **Gate** — deposit/withdraw revert if coverage would fall below 1 (or pool already insolvent / halted)
2. **Monitor** — `halt_if_insolvent` after external asset delta
3. **Panic** — freezes all pool ops until top-up + unpause

## Stack notes

- Confidential on-chain: OpenZeppelin `stellar-confidential` v0.8.0 (wire SDK when deploying circuits)
- Privacy pools: Nethermind SPP on testnet
- Fiat: Pollar Sandbox on Stellar TestNet (ARS/PEN), not a mock bank
