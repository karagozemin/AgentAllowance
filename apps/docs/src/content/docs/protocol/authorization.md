---
title: Authorization model
description: Understand the two-entry delegated Soroban authorization and wallet-admin path.
---

## Autonomous payment authorization

A payment carries exactly two address-auth entries.

```text
Entry 1: smart C-account
  invocation: token.transfer(from=treasury, to=merchant, amount=N)
  signature payload:
    context_rule_ids: [allowance rule]
    signers: Delegated(agent G-account)

Entry 2: delegated G-account
  invocation: treasury.__check_auth(auth_digest)
  signature: Ed25519 delegate signature
```

The transfer must be top-level and have no sub-invocations. A third auth entry, duplicate entry,
changed address, nested invocation, mismatched digest, or over-long expiry fails verification.

## Why the fee payer cannot spend

The fee payer signs the transaction envelope and pays network fees. It is not present in either
address-auth entry and it is not the SEP-41 `from` address. Soroban still calls the smart account's
`__check_auth`, so possession of the fee-payer key does not satisfy treasury authorization.

## Wallet-admin authorization

Creating or revoking a rule is a separate path:

1. backend constructs the exact admin contract invocation;
2. recording simulation returns the treasury admin auth entry;
3. backend returns a canonical `HashIdPreimage` to Freighter;
4. Freighter signs its hash with the wallet owner;
5. backend validates and reconstructs the entry;
6. enforcing simulation runs before fee-payer submission.

Pending admin operations are wallet-bound, one-time, and expire after 60 seconds. A stolen login
session alone cannot create or revoke a rule.

## Context rule isolation

Each allowance refers to one monotonically assigned context rule ID. Policy state keys include both
the treasury C-account and rule ID, so different wallet-owned treasuries can safely use the same rule
numbers without state collision.
