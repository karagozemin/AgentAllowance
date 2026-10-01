# Stellar Smart Account x402 Compatibility Proof

This is a testnet-only compatibility proof. It deploys an OpenZeppelin Stellar Smart Account with one delegated G-account signer and one spending-limit policy, makes the smart account the `from` address of a native-XLM SEP-41 transfer, constructs both authorization entries manually, and submits the resulting unsigned-envelope transaction to the OpenZeppelin x402 v2 facilitator.

It does not contain AgentAllowance, UI code, a production SDK, or MPP.

## Observed result

Phase 1 succeeded in enforcing-mode simulation. The smart account and delegated signer authorization entries were both accepted, the transfer simulated successfully, and the spending-limit policy simulated an update from `0` to `100000` stroops.

Phase 2 was rejected by the facilitator:

```json
{
  "httpStatus": 200,
  "isValid": false,
  "payer": "CAC4C6WUVBSDQUKYQFMHYEJLTBLRWTWTFJWPQB6E43NXX3YA26GFZWEV",
  "invalidReason": "invalid_exact_stellar_payload_event_not_transfer",
  "classification": "event_not_transfer"
}
```

The exact additional contract event was:

```json
{
  "contractId": "CASICWW33P3PIZ4ZTUZPOVVIFVTXJH3HW7SIILF6UMXQ2NDNFCOCRE7N",
  "topics": [
    "spending_limit_enforced",
    "CAC4C6WUVBSDQUKYQFMHYEJLTBLRWTWTFJWPQB6E43NXX3YA26GFZWEV"
  ],
  "data": {
    "amount": "100000",
    "context_rule_id": 0,
    "total_spent_in_period": "100000"
  }
}
```

The facilitator's `parseTransferEventsFromSimulation` marks any contract event whose first topic is not the symbol `transfer` as a non-transfer event. `validateSimulationEvents` then returns `invalid_exact_stellar_payload_event_not_transfer`. See the first-party validator in [OpenZeppelin relayer-plugin-x402-facilitator](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator/blob/100ccec1dcb597544a215f749796870e03c63c45/src/stellar/utils.ts) and the caller in [verify.ts](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator/blob/100ccec1dcb597544a215f749796870e03c63c45/src/stellar/verify.ts).

Per the experiment rules, `/settle` was not called. The on-chain balances and policy state remain unchanged.

## Prerequisites

- Node.js 22 or newer
- pnpm
- Rust 1.84 or newer with `wasm32v1-none`
- Stellar CLI 27 or newer
- An OpenZeppelin testnet facilitator API key

From this directory:

```bash
rustup target add wasm32v1-none
pnpm install
cp .env.example .env.local
```

Set `OZ_X402_API_KEY` in `.env.local`. Secrets are never written to artifacts.

## Reproduction

Each command is independently runnable. Use `pnpm run setup`, not `pnpm setup`, because `setup` is also a pnpm built-in command.

### Setup and deploy

```bash
pnpm run build
pnpm run setup
```

`setup` creates and Friendbot-funds three proof-specific Stellar CLI identities, deploys the policy, deploys the smart account with rule ID `0`, and transfers `5000000` stroops of native XLM into the C-account. Re-running it creates fresh contract deployments and a fresh artifact run.

The constructor installs this rule:

```text
ContextRuleType::CallContract(native XLM SAC)
signers: [Signer::Delegated(delegate G-account)]
policies: [spending-limit policy]
limit: 1000000 stroops per 17280 ledgers
```

### Phase 1: construct and enforce auth

```bash
pnpm run phase1
pnpm run decode
```

`phase1` performs a recording simulation to obtain the smart-account nonce and root invocation. It then:

1. Computes the C-account Soroban authorization payload hash.
2. Computes `auth_digest = sha256(signature_payload || [rule_id].to_xdr())`.
3. Places this custom `AuthPayload` in the C-account auth entry:

```text
AuthPayload {
  signers: { Delegated(delegate_G): Bytes() },
  context_rule_ids: [0]
}
```

4. Builds a second authorization entry for the delegated G-account, rooted at `smart_account.__check_auth(auth_digest)`.
5. Signs that second entry with the delegated account's Ed25519 key.
6. Simulates the transaction with `authMode: "enforce"`.

Both auth entry roots have zero sub-invocations. The transaction envelope is deliberately unsigned because the facilitator rebuilds it with its fee-paying source account.

### Phase 2: verify only

Run this immediately after `phase1`; authorization expirations are intentionally short to satisfy the facilitator's timeout window.

```bash
pnpm run verify
```

The script constructs this x402 v2 request shape and calls only `/verify`:

```json
{
  "paymentPayload": {
    "x402Version": 2,
    "accepted": "<same PaymentRequirements object>",
    "payload": { "transaction": "<base64 transaction envelope XDR>" }
  },
  "paymentRequirements": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "amount": "100000",
    "payTo": "<merchant G-address>",
    "maxTimeoutSeconds": 30,
    "asset": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "extra": { "areFeesSponsored": true }
  }
}
```

Classification is one of `success`, `missing_payer_auth`, `has_subinvocations`, `event_not_transfer`, or `another_error`.

### Phase 3: conditionally settle

```bash
pnpm run settle
pnpm run status
```

`settle` reads `classification.json` and makes no HTTP request unless it equals `success`. When settlement is allowed, it records the exact response and captures post-settlement balances and spending-limit state. In the observed run it prints:

```text
Settlement not called: /verify classification is event_not_transfer.
```

## Artifacts

`artifacts/latest` points to the most recent timestamped run under `artifacts/runs/`. It contains:

- `deployment.json`: public addresses and test parameters
- `state-before.json`: balances and policy state before verification
- `simulation-record-response.json`: complete recording simulation response
- `simulation-enforce-response.json`: complete enforcing simulation response, events, state changes, and resource data
- `events-decoded.json`: decoded diagnostic and contract events
- `rejected-policy-event.json`: the exact policy event rejected by the facilitator validator
- `auth-smart-account.xdr`: signed C-account authorization entry
- `auth-delegated-signer.xdr`: signed delegated G-account authorization entry
- `auth-entries.json`: auth entry roots and XDR
- `transaction.xdr`: unsigned-envelope transaction passed to the facilitator
- `x402-payment-payload.json`: exact `/verify` request body
- `verify-response.json` and `verify-response-body.txt`: exact HTTP result
- `classification.json`: normalized experiment result
- `settle-response.json`: present only if `/verify` succeeded and settlement was attempted
- `state-after.json`: present only after an allowed settlement attempt

No secret key or facilitator API key is stored in these artifacts.

## First-party implementation sources

- [OpenZeppelin smart-account example](https://github.com/OpenZeppelin/stellar-contracts/blob/v0.7.2/examples/multisig-smart-account/account/src/contract.rs)
- [OpenZeppelin spending-limit policy example](https://github.com/OpenZeppelin/stellar-contracts/blob/v0.7.2/examples/multisig-smart-account/spending-limit-policy/src/contract.rs)
- [OpenZeppelin delegated signer and AuthPayload implementation](https://github.com/OpenZeppelin/stellar-contracts/blob/v0.7.2/packages/accounts/src/smart_account/storage.rs)
- [OpenZeppelin spending-limit implementation and event](https://github.com/OpenZeppelin/stellar-contracts/blob/v0.7.2/packages/accounts/src/policies/spending_limit.rs)
- [Stellar x402 v2 reference implementation](https://github.com/stellar/x402-stellar/tree/7a96df856f533a5f13feaa48340e10cee1f9e37f)
- [Stellar JavaScript SDK](https://github.com/stellar/js-stellar-sdk)

Exact versions and source commits are pinned in `sources.json`, `Cargo.lock`, and `pnpm-lock.yaml`.

