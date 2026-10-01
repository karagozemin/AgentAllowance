---
title: SDK API reference
description: Public AgentAllowance client, allowance, payment, evidence, wallet, and deployment APIs.
tableOfContents:
  minHeadingLevel: 2
  maxHeadingLevel: 3
---

All exports are available from `@agentallowance/sdk`. The package uses ESM and requires Node.js
22.18 or newer.

## `new AgentAllowance(config)`

Creates a client bound to one network, asset, treasury, policy deployment, facilitator, fee payer,
and delegated signer set. See [installation](/sdk/install/) for the complete configuration table.

## Allowance API

### `allowances.create(input)`

Creates one on-chain context rule.

```ts
type AllowanceCreateInput = {
  label: string;
  delegatedSigner: string;
  maxSpendAtomic: string;
  windowSeconds: number;
  allowedRecipients: string[];
  expiresInSeconds: number;
};
```

Returns `Promise<AllowanceRecord>`. The current MVP requires exactly one recipient.

### `allowances.get(id)`

Returns `Promise<AllowanceRecord>`. Refreshes spending and ledger expiry from chain before returning.

### `allowances.list()`

Returns `Promise<AllowanceRecord[]>` after refreshing each locally indexed allowance.

### `allowances.revoke(id)`

Removes the selected context rule and returns the record with `status: "REVOKED"` and
`revokeTxHash`.

### `treasury.balance()`

Returns `Promise<string>` containing the configured asset balance in atomic units.

## Payment API

### `preflight(requirements, allowance, currentLedger)`

Returns a typed `PolicyDecision` for explanatory local validation. It does not replace on-chain
enforcement.

### `fetch(url, options)`

```ts
await aa.fetch(url, {
  allowanceId: "2",
  request: { method: "GET", headers: { Accept: "application/json" } },
  signal: AbortSignal.timeout(30_000),
});
```

Performs the complete challenge, authorization, settlement, receipt, and resource-unlock flow.
Returns the unlocked `Response`.

### `pay(challenge, options)`

Verifies and settles parsed `PaymentRequired` without retrying the protected HTTP resource. Returns
`Promise<SettlementReceipt>`.

### `reconcile(attemptId)`

Checks merchant payment status for an ambiguous or submitted attempt. Never creates a second
payment.

### `getAttempt(attemptId)`

Returns one normalized `PaymentAttempt`, or `undefined` when it is not present in the evidence store.

### `listAttempts(limit?)`

Returns recent `PaymentAttempt[]`, including decision, state, reason code, transaction hash, receipt,
and safe detail.

## Evidence stores

### `new SqliteEvidenceStore(path)`

Durable single-process implementation backed by `node:sqlite`. Use `:memory:` only in tests.

### `EvidenceStore`

Inject a custom implementation through the client `store` option. It must preserve allowance
records, attempt records, and the unique allowance/request-reference relationship used for
idempotency.

## Wallet administration

### `prepareCreateContextRuleAuthorization(config, input)`

Records the exact admin invocation and returns a prepared call containing
`adminAuthPreimageXdr`.

### `prepareRevokeContextRuleAuthorization(config, contextRuleId)`

Prepares the exact remove-context-rule authorization.

### `applyWalletAdminSignature(prepared, signature)`

Reconstructs the Stellar authorization entry from a canonical wallet signature.

### `validateSignedWalletAdminEntry(...)`

Validates signer address, network, nonce, expiry, invocation, tree shape, and Ed25519 signature.

### `submitWalletAdminCall(config, prepared, signature)`

Validates, runs enforcing simulation, signs the fee-payer envelope, submits, and returns transaction
hash and contract return value.

## Treasury deployment

### `deterministicTreasuryContractId(owner, config)`

Derives the owner C-account address without submitting a transaction.

### `deployDeterministicTreasury(owner, config)`

Returns the existing deterministic treasury or deploys it with the owner as admin.

### `treasuryExists(rpcUrl, contractId)`

Checks whether the contract instance exists on the selected network.

### `fundTreasuryFromSponsor(options)`

Transfers an explicit atomic asset amount from the configured Testnet sponsor to a treasury. Funding
does not change authorization policy.

## Re-exported types

The package re-exports shared x402 and policy types, including `AllowanceRecord`, `PaymentAttempt`,
`PaymentRequired`, `PaymentRequirements`, `SettlementReceipt`, `PolicyDecision`, `PolicyReason`, and
`REASON_MESSAGES`.
