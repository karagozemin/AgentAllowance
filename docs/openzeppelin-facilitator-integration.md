# OpenZeppelin Facilitator Integration

## Base implementation

Pin the fork to OpenZeppelin `relayer-plugin-x402-facilitator` commit:

```text
100ccec1dcb597544a215f749796870e03c63c45
```

The workspace fork is `packages/relayer-plugin-x402-facilitator`. It retains the upstream source and
test suite. The extension must not replace the existing structural, fee, source-account, expiry, simulation, or
ordinary G-account checks. It changes the final simulation-event branch only for a payer that has a
trusted server-side policy manifest.

## Trusted configuration

Extend the Stellar network configuration with `policy_manifests`. Do not accept a manifest supplied
inside `paymentPayload`, `paymentRequirements.extra`, or any other client-controlled field.

At process startup:

1. Parse every manifest.
2. Call `assertProductionManifest` so every policy adapter pins a 32-byte WASM hash.
3. Reject duplicate `(network, smartAccount)` profiles.
4. Log the manifest ID and a hash of the normalized manifest.

The MVP accepts exactly one required adapter: OpenZeppelin spending limit `0.7.2`. It does not accept
or require `recipient_policy_enforced`. Recipient enforcement is demonstrated by the signed rule ID,
on-chain recipient configuration, enforcing simulation, and a rejected unapproved-recipient attempt.

## Verification insertion

In `src/stellar/verify.ts`, retain the canonical checks through successful enforcing simulation. Then:

1. Resolve a manifest by `networkConfig.network` and `fromAddress`.
2. If none exists, call OpenZeppelin's original `validateSimulationEvents` unchanged.
3. If one exists, fetch each policy contract instance with `getLedgerEntries` using
   `contractInstanceLedgerKey(contractId)`.
4. Decode each current executable hash with `extractContractWasmHash`.
5. Call `verifyPolicyAwarePayment` with the exact transaction XDR, payment requirements, simulation
   events, trusted manifest, and observed hashes.
6. Return its stable `invalidReason` when invalid.
7. Return the canonical success response only when both the original checks and extension succeed.

Representative insertion:

```ts
const manifest = policyManifests.find(
  (candidate) =>
    candidate.network === networkConfig.network && candidate.smartAccount === fromAddress,
);

if (!manifest) {
  // Existing OpenZeppelin strict event validation remains unchanged.
  return validateCanonicalEventsOrSuccess(/* existing arguments */);
}

const observedWasmHashes = await resolvePolicyWasmHashes(relayer, manifest);
const policyDecision = await verifyPolicyAwarePayment({
  x402Version: paymentPayload.x402Version,
  transactionXdr: stellarPayload.transaction,
  paymentRequirements,
  simulationEvents,
  manifest,
  observedWasmHashes,
});

if (!policyDecision.isValid) {
  return invalidResponse(policyDecision.invalidReason, fromAddress);
}
```

## Settlement rule

`/settle` must not trust an earlier `/verify` response indefinitely. Before submission it must rerun
the same canonical checks, enforcing simulation, code-hash resolution, auth-profile validation, and
event validation. A short-lived internal verification token is acceptable only if it is bound to the
transaction XDR hash, payment requirements hash, manifest hash, and an expiry ledger.

The unsigned client envelope uses a builder source distinct from the configured relayer. During
settlement, OpenZeppelin Relayer rebuilds the transaction and its configured G-account becomes the
final transaction source and fee payer. That relayer address must not equal the smart-account payer,
merchant, delegated signer, or either address-auth entry.

## Local deployment

Prerequisites are Docker Desktop, Docker Compose, Stellar CLI, Rust, Node.js, and pnpm. The official
Relayer image is pinned to `1.7.0`; the fork is pinned to upstream plugin commit
`100ccec1dcb597544a215f749796870e03c63c45`.

```bash
pnpm install
pnpm --filter @agentallowance/testnet-cli run deploy
STATE_LABEL=before pnpm --filter @agentallowance/testnet-cli run status
pnpm run relayer:prepare
pnpm run relayer:start
```

`relayer:prepare` creates an encrypted OpenZeppelin keystore using first-party `oz-keystore 0.1.4`,
bundles the plugin, and writes a git-ignored runtime config. Check readiness:

```bash
source artifacts/local/relayer/latest.env
curl -fsS -X POST "$X402_FACILITATOR_URL/supported" \
  -H "Authorization: Bearer $X402_FACILITATOR_API_KEY" \
  -H "Content-Type: application/json" -d '{}'
```

Run each Testnet case as a fresh attempt:

```bash
SCENARIO=over-limit pnpm --filter @agentallowance/testnet-cli run authorize
pnpm --filter @agentallowance/testnet-cli run verify

SCENARIO=unapproved-recipient pnpm --filter @agentallowance/testnet-cli run authorize
pnpm --filter @agentallowance/testnet-cli run verify

SCENARIO=successful-payment pnpm --filter @agentallowance/testnet-cli run authorize
pnpm --filter @agentallowance/testnet-cli run verify
```

Stop after successful verification and review the exact attempt's payment, XDR, auth entries,
simulation response, request, and facilitator response. Settlement requires separate approval plus
`ALLOW_SETTLEMENT=yes`.

## Rollback and cleanup

```bash
pnpm run relayer:stop
cargo clean
cargo clean --manifest-path tools/relayer-keystore/Cargo.toml
```

Stopping Compose removes local containers and the network; the named Redis volume is retained. To
remove that volume, run `docker compose ... down -v` only after explicitly deciding its data is no
longer needed. Testnet contracts are immutable and require no privileged cleanup; abandon their IDs
and preserve the timestamped evidence.

## Compatibility boundary

- Unconfigured G-accounts retain OpenZeppelin's original behavior.
- Configured AgentAllowance C-accounts require exactly two auth entries.
- Unknown contract events remain rejected.
- The only initial policy adapter is OpenZeppelin spending limit `0.7.2`.
- Hosted OpenZeppelin infrastructure is not assumed to contain this extension.
