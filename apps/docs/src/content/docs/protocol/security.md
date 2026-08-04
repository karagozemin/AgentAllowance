---
title: Security model
description: Fail-closed validation, custody boundaries, replay controls, and known limitations.
---

AgentAllowance coordinates authorization; on-chain policy makes the final decision. Every layer
rejects unexpected structure rather than trying to interpret it permissively.

## Fail-closed invariants

- x402 version, scheme, network, asset, amount, payer, and recipient must match.
- The invocation must be one top-level SEP-41 `transfer` with no sub-invocations.
- Exactly two expected address-auth entries must be present.
- Authorization nonce and ledger expiry must be bounded and valid.
- Treasury and policy contracts must match manifest-pinned WASM hashes.
- Enforcing simulation must succeed.
- One exact transfer event and one approved spending-policy event must be present.
- Recipient policy state must match the signed token and recipient.
- Unknown, duplicate, spoofed, malformed, or unrelated events are rejected.
- The receipt must bind every signed payment term and transaction hash.
- Duplicate request references cannot create another attempt.

## Replay and idempotency

Soroban authorization uses nonce and ledger expiry. Merchant challenges are unique and expiring. The
merchant claims a challenge atomically before settlement. SDK evidence applies a unique
allowance/request-reference relationship. Unknown settlement is reconciled rather than resubmitted.

## Browser boundary

The React bundle contains no delegated signer, fee-payer secret, facilitator credential, or owner
key. Owner login uses a two-minute SEP-53 challenge. The server issues a signed, HttpOnly, SameSite
cookie valid for 24 hours. On-chain mutations still require a separate, exact Freighter authorization
signature.

## Public demo boundary

Anonymous callers choose only one of three server-defined scenarios. They cannot supply amount,
recipient, asset, URL, signer, or transaction XDR. Successful public settlements are rate-limited,
and the on-chain spending cap remains the final loss bound.

## Known limitations

- contracts and hosted infrastructure are unaudited;
- current proof targets Stellar Testnet;
- SQLite deployments are single-instance demos;
- owner and delegated signer recovery is not a complete production design;
- the current recipient policy supports one recipient per allowance;
- the facilitator extension is pinned to a specific approved contract deployment.

Review [production readiness](/guides/production-readiness/) before considering real custody.
