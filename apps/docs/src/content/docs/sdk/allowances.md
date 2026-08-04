---
title: Manage allowances
description: Create, inspect, expire, and revoke bounded authority.
---

## Create an allowance

```ts
const allowance = await aa.allowances.create({
  label: "research-agent",
  delegatedSigner: delegate.publicKey(),
  maxSpendAtomic: "1000000",
  windowSeconds: 86_400,
  allowedRecipients: [merchantAddress],
  expiresInSeconds: 3_600,
});
```

The current MVP requires exactly one recipient. The returned record contains the on-chain context
rule ID and `createTxHash`.

## Read current state

```ts
const current = await aa.allowances.get(allowance.allowanceId);
const all = await aa.allowances.list();
```

Reads refresh spending state and ledger expiry from chain. If chain state cannot be refreshed, the
SDK returns `ERROR` instead of presenting cached state as active.

## Lifecycle

| Status | Meaning | Can authorize payment? |
| --- | --- | --- |
| `ACTIVE` | Rule exists, is within expiry, and has budget | Yes |
| `EXHAUSTED` | Rolling spend reached the configured cap | No |
| `EXPIRED` | Current ledger passed `validUntilLedger` | No |
| `REVOKED` | Owner removed the context rule | No |
| `ERROR` | State could not be refreshed safely | No |

## Revoke one rule

```ts
const revoked = await aa.allowances.revoke(allowance.allowanceId);
console.log(revoked.revokeTxHash);
```

Revocation removes only the selected context rule. Other agents and allowances remain active.
Repeated calls are idempotent after the local record is marked revoked.

## Wallet-owned administration

Do not put the owner's Freighter key in the Node.js SDK process. Use the two-phase helpers:

1. `prepareCreateContextRuleAuthorization()` or `prepareRevokeContextRuleAuthorization()`;
2. ask Freighter to sign the returned authorization preimage;
3. call `submitWalletAdminCall()` with the wallet signature.

The submission path validates the signer, network, nonce, expiry, root invocation, signature, and
authorization tree before the fee payer submits the transaction.
