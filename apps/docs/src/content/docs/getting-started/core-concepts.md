---
title: Core concepts
description: Learn the treasury, allowance, delegated signer, x402, and evidence vocabulary.
---

## Treasury

A treasury is a Stellar smart C-account that holds the configured asset and makes the SEP-41
transfer. It has no exported treasury private key. For wallet-owned flows, the connected Freighter
address becomes rule `0` admin when the treasury is deployed.

The treasury address is deterministic over the owner, network, fee sponsor, approved WASM, asset,
policy contracts, and deployment version.

## Allowance

An allowance is an independent smart-account context rule. It contains:

- one delegated G-account signer;
- one allowed token contract invocation;
- one rolling spending limit and window;
- one approved recipient in the current MVP;
- one ledger-bounded expiry.

Allowances are isolated. Revoking one agent's rule does not revoke another agent.

## Delegated signer

The delegated signer represents the autonomous agent. It signs the exact payment authorization but
cannot modify the allowance, change the recipient, increase the budget, or administer the treasury.

The delegated key belongs in a trusted server or isolated signing process. It is not a browser wallet
and it is not the transaction fee payer.

## Atomic amount

Amounts are strings in the asset's smallest unit. USDC uses seven decimal places on Stellar:

```text
0.01 USDC = 100000 atomic
0.10 USDC = 1000000 atomic
1.00 USDC = 10000000 atomic
```

Use integer strings throughout policy and payment code. Do not derive financial values with
floating-point arithmetic.

## x402 challenge

An x402 merchant returns HTTP `402 Payment Required` with exact network, asset, amount, recipient,
scheme, and challenge identity. AgentAllowance supports x402 v2 `exact` Stellar payments in the MVP.

The paid retry carries `PAYMENT-SIGNATURE`. The merchant returns `PAYMENT-RESPONSE` after settlement.
The SDK rejects a receipt that does not match the original challenge.

## Policy decision

Local preflight returns an explanatory `ALLOW` or `BLOCK`, but it is not the security boundary. The
authoritative path is enforcing Soroban simulation plus facilitator verification of the invocation,
authorization entries, policy configuration, events, and contract code identity.

## Attempt and reconciliation

Every payment receives an `attemptId` and moves through a durable state machine:

```text
CREATED -> VALIDATED -> SIGNED -> VERIFIED -> SUBMITTED -> SETTLED -> UNLOCKED
                  \-> BLOCKED
                                      \-> UNKNOWN -> reconcile()
```

An unknown submission outcome is not a failed payment. Reconcile the same attempt before deciding
whether another payment is safe.
