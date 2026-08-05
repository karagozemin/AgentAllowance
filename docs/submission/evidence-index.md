# Submission Evidence Index

This index is intentionally reviewer-first. Every claim points to an append-only artifact or a
repeatable command. Testnet state is volatile; transaction hashes and the sanitized response files are
the durable record.

For the chronological XLM, dynamic-rule, official USDC, and wallet-owner settlement narrative, see
the [Testnet settlement history](../evidence/settlement-history.md).

| Claim | Evidence | What to inspect |
| --- | --- | --- |
| Public demo has a fresh active allowance | [Renewal evidence](../evidence/testnet/2026-08-05T00-04-29Z-public-demo-renewal/renewal.json) | rule `2`, 30-day expiry, policy configuration, positive treasury balance, and admin transaction hash |
| Hosted wallet-owner USDC flow works end to end | [Latest hosted evidence](../evidence/testnet/2026-08-03T23-49-21Z-hosted-wallet-settlement/public-demo.json) | `PAID_AND_UNLOCKED`, hosted receipt, two policy blocks, transaction hash and exact state deltas |
| Facilitator accepts the policy-aware transaction without weakening validation | [RPC transaction facts](../evidence/testnet/2026-08-03T23-49-21Z-hosted-wallet-settlement/transaction-result.json) | two auth entries, no sub-invocations, exact transfer and the single approved policy event |
| Official Testnet USDC x402 payment settled | [USDC settlement](../evidence/testnet/2026-08-03T20-19-52Z/settlement.json) | asset SAC, `isValid`, transaction hash, amount, exact state deltas |
| Treasury paid the merchant | [USDC evidence README](../evidence/testnet/2026-08-03T20-19-52Z/README.md) | Stellar Expert link, balances, and ledger |
| Public demo unlocks the protected resource | [Public demo USDC evidence](../evidence/testnet/2026-08-03T20-41-03Z/public-demo.json) | two blocks, paid retry, `PAID_AND_UNLOCKED`, receipt, and state deltas |
| Delegated authorization works | [Compatibility proof](../../proofs/stellar-x402-smart-account/README.md) | two auth entries, simulation, XDR |
| Spending limit blocks excess | [USDC blocked attempts](../evidence/testnet/2026-08-03T20-19-52Z/blocked-attempts.json) | failed enforcing simulation, facilitator rejection, no settlement |
| Recipient policy blocks wrong payTo | [USDC blocked attempts](../evidence/testnet/2026-08-03T20-19-52Z/blocked-attempts.json) | failed enforcing simulation, facilitator rejection, no settlement |
| Expiry blocks stale authority | [Expired allowance](../evidence/testnet/2026-08-03T13-18-26Z/expired-allowance.json) | ledger and denial reason |
| Revocation blocks old signer | [Revoked allowance](../evidence/testnet/2026-08-03T13-18-26Z/revoked-allowance.json) | removal transaction and denied retry |
| Facilitator remains strict | `pnpm test` | malformed event/auth/security regression tests |
| Reusable integration exists | [SDK example](../../apps/x402-sdk-example/README.md) | independent consumer of `@agentallowance/sdk` |
| Fresh-checkout verification stays below ten minutes | [Quickstart benchmark](quickstart-benchmark.md) | clean runner scope, timestamps, commit, workflow URL |
| Secrets stay out of browser | [Security model](../security.md) | signer boundaries and fallback warnings |

## Reproduce locally

```bash
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm --filter @agentallowance/x402-sdk-example typecheck
```

For a new live run, use the Testnet CLI. Set `ATTEMPT_DIRECTORY` or `RUN_DIRECTORY` when inspecting a
specific run; never overwrite an old evidence directory.
