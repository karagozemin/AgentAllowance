---
title: Architecture
description: Components, trust boundaries, contracts, and state ownership.
---

AgentAllowance combines an OpenZeppelin Stellar smart account, on-chain allowance policies, a strict
x402 payer, a policy-aware facilitator, and merchant challenge state.

## System context

```text
Freighter owner
    | wallet login + signed admin authorization
    v
Console ----------------------> deterministic smart-account treasury
                                     |             |
Delegated agent ---- x402 ---------->|             +--> recipient policy
    |                                +----------------> spending policy
    v
Merchant API ---- verify/settle ----> policy-aware facilitator
                                          |
                                          v
                                  OpenZeppelin Relayer
                                          |
                                          v
                              exact SEP-41 USDC transfer
```

## Trust boundaries

| Component | Authority | Cannot legitimately do |
| --- | --- | --- |
| Freighter owner | Authenticate and sign its own rule changes | Sign agent payments unless delegated separately |
| Console | Deploy deterministic treasuries, sponsor fees, index evidence | Act as treasury admin |
| Delegated agent | Authorize one payment under one context rule | Change policy or recipient |
| Smart account | Make the final authorization decision | Act as transaction source |
| Policy contracts | Enforce spend and recipient state | Execute arbitrary payments |
| Merchant | Issue and claim challenges, unlock content | Sign payer authorization |
| Facilitator | Verify exact payload and submit approved XDR | Change signed terms |
| Relayer | Source and fee-payer submission | Appear as payer or delegate |

## Contract architecture

### Treasury smart account

`contracts/treasury-account` composes OpenZeppelin `stellar-accounts` 0.7.2. Rule `0` is the wallet
admin. Payment allowances are separate context rules with call scope, delegated signer, expiry,
spending policy, and recipient policy.

### Spending-limit policy

`contracts/spending-limit-policy` integrates OpenZeppelin's rolling spending limit. It stores spend
per `(treasury, rule ID)` and emits `spending_limit_enforced` for an approved transfer.

### Recipient policy

`contracts/recipient-policy` allows only the configured token and recipient. The facilitator reads
its pinned on-chain configuration for the signed rule ID.

## State ownership

- **On chain:** balances, context rules, expiry, spend, recipient, policy configuration, WASM identity.
- **Merchant database:** challenges, atomic settlement claims, protected-resource state.
- **SDK evidence store:** allowance index, payment attempts, decisions, receipts, reconciliation.
- **Append-only artifacts:** transaction XDR, simulation, events, state deltas, public evidence.

On-chain state remains authoritative. An unavailable chain read produces an error state, not an
optimistic cached approval.

## Repository map

```text
apps/console                         dApp and wallet-owner orchestration
apps/x402-demo-api                   merchant challenge and protected resource
apps/testnet-cli                     deployment and evidence commands
contracts/treasury-account           OpenZeppelin smart account
contracts/spending-limit-policy      rolling budget enforcement
contracts/recipient-policy           exact destination enforcement
packages/sdk                         public application API
packages/stellar-smart-account-auth  delegated Soroban authorization
packages/x402-payer                  strict x402 payer and facilitator client
packages/facilitator-policy          policy event and WASM verification
packages/relayer-plugin-*             OpenZeppelin Relayer integration
```
