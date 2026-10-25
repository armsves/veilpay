import init from './prover-worker-module.js';
// Circuits stay on Nethermind GH Pages (too large for Vercel). Workers must be
// same-origin or gloo-worker panics with "failed to spawn worker".
globalThis.__STELLAR_PRIVATE_PAYMENTS_CIRCUITS_BASE__ =
  'https://nethermindeth.github.io/stellar-private-payments/js/stellar-private-payments/dist/circuits/';
await init();
