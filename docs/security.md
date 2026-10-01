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
