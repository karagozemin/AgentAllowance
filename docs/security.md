# Security model

The facilitator accepts exactly one top-level SEP-41 `transfer(from, to, amount)` invocation and
exactly two signed address-auth entries: the smart C-account payer and the delegated G-account.
Envelope signatures, unexpected auth entries, nested invocations, relayer participation, mismatched
asset/network/amount/recipient, stale or over-long auth expiry, and unsupported fee bounds fail closed.

Simulation must contain the exact transfer event set plus one required `spending_limit_enforced`
event from the manifest-pinned OpenZeppelin policy contract and WASM hash. The event payer, token,
amount and rule ID must match the signed invocation. Duplicate, missing, spoofed, malformed, unknown,
or unapproved-WASM events are rejected. Recipient policy emits no payment-time event; its token and
recipient are read from the manifest-pinned contract for the signed rule ID.

The merchant service binds every payment payload to a stored, expiring challenge. Requirements must
match byte-for-byte at the semantic field level. An atomic SQLite claim permits one in-flight
settlement. A network failure after submission remains `SETTLEMENT_PENDING` for reconciliation and is
not automatically resubmitted. Receipts are matched again against payer, network, asset, amount,
recipient, challenge ID and transaction-hash shape before protected content is returned.

This is Testnet software and the contracts are unaudited. The local SQLite deployment is suitable for
a single-instance demo only; production requires a transactional shared database, authenticated
console administration, key management/HSM integration, rate limits, monitoring and independent
contract/facilitator audits.

## Wallet-owner administration

The owner login challenge is random, single-use, and valid for two minutes. A session is created only
after an Ed25519 signature from the configured treasury admin and expires after 24 hours in a signed,
HttpOnly, SameSite cookie. The stateless signature survives a service restart and rejects modified
session payloads. A wallet-admin mutation uses a separate Soroban authorization signature.
Prepared operations expire after sixty seconds and are deleted on first submission attempt.

The backend gives Freighter the canonical Stellar authorization `HashIdPreimage` and accepts only a
canonical 64-byte signature over its hash. It rejects the authorization if the signer address,
network, nonce, signature-expiry ledger, root invocation, or invocation tree differs from the prepared
template. It then reconstructs the auth entry and runs enforcing-mode simulation before the fee payer
signs and submits the envelope. A stolen web session alone therefore cannot create or revoke an
allowance without a fresh Freighter signature.

## Public demo controls

The public demo endpoint accepts only three named scenarios and chooses the configured allowance on
the server. Callers cannot supply an amount, recipient, asset, URL, signer, or transaction XDR. A
successful settlement is rate-limited per forwarded client address, while the on-chain spending cap
provides the final global loss bound. Blocked scenarios still execute the same application and smart-
account policy paths but never call settlement after denial.
