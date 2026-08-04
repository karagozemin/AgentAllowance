# SDK Security Model

The SDK coordinates authorization; it does not replace on-chain policy.

## Key roles

| Role | Capability | Must not be able to do |
| --- | --- | --- |
| Treasury owner | Create and revoke its own rules | Sign autonomous payments unless separately delegated |
| Delegated signer | Authorize the exact invocation allowed by one rule | Change allowance policy or spend outside it |
| Fee payer | Submit and sponsor Soroban transactions | Bypass smart-account authorization |
| Facilitator | Verify, settle, and return evidence | Change signed amount, recipient, asset, or payer |

Keep all `Keypair` objects in trusted server or isolated signer processes. The package uses
`node:sqlite` and is intentionally not browser-safe. Freighter administration uses exported preimage
preparation and signature validation functions so the owner key never reaches the SDK backend.

## Fail-closed checks

- Network and asset must match the configured allowance.
- Recipient must match the on-chain recipient policy.
- Amount must fit the remaining rolling budget.
- Rule must be active and within ledger expiry.
- Delegated signer must match the selected context rule.
- Soroban invocation and authorization-entry structure must be exact.
- Settlement receipt must bind payer, network, asset, amount, recipient, and challenge.
- Duplicate request references are rejected.
- Unknown settlement state is reconciled instead of blindly retried.

Local `preflight` is advisory. A local ALLOW result never replaces enforcing Soroban simulation or
facilitator verification.

## Production warning

The current release is unaudited and proven only on Stellar Testnet. Production deployment requires a
custody design, threshold administration and recovery, operational key rotation, monitored RPC and
facilitator infrastructure, database backup, incident response, and an independent contract/security
audit.

See the repository-wide [security model](../security.md) for the full threat matrix.
