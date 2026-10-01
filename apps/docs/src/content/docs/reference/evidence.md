---
title: Evidence and verification
description: Reproduce the checks and inspect transaction, XDR, event, receipt, and state proof.
---

AgentAllowance keeps product claims tied to reproducible checks or append-only Testnet artifacts.

## What is archived

- exact x402 requirements and payment payload;
- recording and enforcing simulation responses;
- transaction XDR and Soroban authorization entries;
- facilitator verify and settle responses;
- transaction result and diagnostic events;
- treasury, merchant, and spending-policy state deltas;
- normalized allow/block reason codes;
- receipt and stable receipt hash.

## Proven scenarios

| Scenario | Expected result | Funds move? |
| --- | --- | --- |
| Approved 0.01 USDC | `PAID_AND_UNLOCKED` with transaction receipt | Yes |
| Over rolling limit | `BUDGET_EXCEEDED` or enforcing rejection | No |
| Unapproved recipient | `RECIPIENT_NOT_ALLOWED` or enforcing rejection | No |
| Expired allowance | `ALLOWANCE_EXPIRED` | No |
| Revoked allowance | `ALLOWANCE_REVOKED` | No |
| Unknown submission | Preserved for reconciliation | Never blindly retried |

## Run the verification portfolio

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:sdk-package
cargo test --workspace --locked
stellar contract build
pnpm --filter @agentallowance/console test:e2e
```

CI also runs a secret scan, clean package installation/import smoke test, desktop/mobile browser
tests, and locked contract build.

## Inspect repository evidence

- [Evidence index](https://github.com/karagozemin/AgentAllowance/blob/main/docs/submission/evidence-index.md)
- [Settlement history](https://github.com/karagozemin/AgentAllowance/blob/main/docs/evidence/settlement-history.md)
- [Compatibility proof](https://github.com/karagozemin/AgentAllowance/tree/main/proofs/stellar-x402-smart-account)
- [Technical verification](https://github.com/karagozemin/AgentAllowance/blob/main/docs/technical/verification.md)
- [GitHub Actions](https://github.com/karagozemin/AgentAllowance/actions)

## Verify package artifacts

```bash
pnpm test:sdk-package
pnpm pack:sdk
```

The smoke script packs all public workspace packages, installs the tarballs in a clean temporary
consumer, compiles the public types, and imports the runtime artifacts.
