# SDK API Reference

All public exports are available from `@agentallowance/sdk`. The package uses ESM and Node.js 22.18+.

## `new AgentAllowance(config)`

Required configuration:

| Field | Purpose |
| --- | --- |
| `network` | `stellar:testnet` or `stellar:pubnet` |
| `rpcUrl` | Soroban RPC endpoint |
| `horizonUrl` | Optional Horizon endpoint; defaults by network |
| `assetContract` | SEP-41 asset contract allowed by the treasury |
| `treasuryContract` | Smart C-account that pays |
| `spendingPolicy` | OpenZeppelin spending-limit policy contract |
| `recipientPolicy` | Exact-recipient policy contract |
| `facilitatorUrl` | x402 facilitator plugin endpoint |
| `facilitatorApiKey` | Optional server-side facilitator credential |
| `transactionSource` | Fee-payer `Keypair` used for transaction submission |
| `adminAddress` | Wallet-owned treasury admin address |
| `adminSigner` | Optional backend-held admin `Keypair`; do not use with wallet custody |
| `delegatedSigners` | Public-key to delegated `Keypair` map |
| `store` | Optional custom `EvidenceStore` |
| `databasePath` | SQLite path when no custom store is supplied |

## Allowances

### `allowances.create(input)`

Creates one on-chain context rule and returns an `AllowanceRecord` with its transaction hash.

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

The current MVP requires exactly one recipient. Amounts are atomic units.

### `allowances.get(id)`

Refreshes spending state and ledger expiry before returning the record. A failed chain read returns an
`ERROR` status rather than presenting stale state as active.

### `allowances.list()`

Returns locally known allowances after refreshing each record from chain state.

### `allowances.revoke(id)`

Removes only the selected context rule and records `revokeTxHash`. Calling it again is idempotent after
the local record is marked `REVOKED`.

### `treasury.balance()`

Returns the configured asset balance in atomic units.

## Payments

### `preflight(requirements, allowance, currentLedger)`

Returns a typed `PolicyDecision`. This check explains obvious denials locally; on-chain authorization
remains final.

### `fetch(url, options)`

Performs the request, parses an x402 v2 challenge, authorizes the exact transfer, sends
`PAYMENT-SIGNATURE`, validates `PAYMENT-RESPONSE`, and returns the unlocked `Response`.

```ts
await aa.fetch(url, {
  allowanceId: "2",
  request: { method: "GET", headers: { Accept: "application/json" } },
  signal: AbortSignal.timeout(30_000),
});
```

### `pay(challenge, options)`

Verifies and settles a parsed `PaymentRequired` without performing the protected-resource retry. It
returns a bound `SettlementReceipt`.

### `reconcile(attemptId)`

Checks the merchant payment-status endpoint for an attempt in `UNKNOWN` or `SUBMITTED`. It never
creates a second payment.

### `getAttempt(attemptId)` and `listAttempts(limit?)`

Return normalized evidence records containing lifecycle state, policy decision, reason code,
transaction hash, receipt hash, and safe detail.

## Evidence stores

`SqliteEvidenceStore` is the default durable implementation. Inject an `EvidenceStore` to use another
database. The interface stores `AllowanceRecord` and `PaymentAttempt` objects and must preserve the
unique allowance/reference relationship used for idempotency.

## Wallet-owned administration

For Freighter custody, use:

- `prepareCreateContextRuleAuthorization`
- `prepareRevokeContextRuleAuthorization`
- `submitWalletAdminCall`
- `applyWalletAdminSignature`
- `validateSignedWalletAdminEntry`

The preparation result contains the exact Stellar authorization preimage. The submission path
revalidates signer address, nonce, expiry, invocation, and signature before enforcing simulation.

## Treasury deployment helpers

- `deterministicTreasuryContractId`
- `deployDeterministicTreasury`
- `treasuryExists`
- `fundTreasuryFromSponsor`

Deterministic deployment binds owner, network, deployer, WASM hash, asset, and policy contracts into
the salt. Funding is an explicit Testnet/operator action.
