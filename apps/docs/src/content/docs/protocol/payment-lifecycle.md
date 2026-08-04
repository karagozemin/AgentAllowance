---
title: Payment lifecycle
description: Follow a payment from HTTP 402 through policy enforcement, settlement, and resource unlock.
---

## Successful path

| Step | Actor | Action | Durable evidence |
| ---: | --- | --- | --- |
| 1 | Merchant | Returns stored x402 v2 requirements | Challenge ID and expiry |
| 2 | SDK | Validates network, asset, amount, recipient, allowance | `CREATED`, then `VALIDATED` attempt |
| 3 | SDK | Records the smart-account auth entry | Simulation response |
| 4 | Delegate | Signs the treasury `__check_auth` digest | Two address-auth entries |
| 5 | Smart account | Enforces allowance in simulation | Transfer and policy events |
| 6 | Merchant | Atomically claims the challenge | One in-flight settlement |
| 7 | Facilitator | Verifies invocation, auth, WASM, events, policy state | `isValid: true` |
| 8 | Relayer | Submits the exact verified transaction | Transaction hash |
| 9 | Merchant | Validates receipt and unlocks resource | `PAYMENT-RESPONSE` |
| 10 | SDK | Binds receipt to original terms | `UNLOCKED` attempt |

## Policy denial

An over-limit or unapproved-recipient attempt follows the same challenge and authorization path until
enforcing simulation. The smart account rejects it before settlement. The attempt becomes `BLOCKED`,
and no USDC transfer occurs.

The UI may describe a denial as a successful policy enforcement. It must not describe it as a
settlement failure or silently retry with changed terms.

## Verification denial

The facilitator rejects any mismatch in payer, network, token, amount, recipient, transfer shape,
authorization entry, rule ID, code hash, or approved event. A verifier failure is definitive unless
the reason explicitly indicates an infrastructure outage before submission.

## Ambiguous submission

If the transaction may have been submitted but no final receipt is available, the attempt moves to
`UNKNOWN`. The SDK preserves its attempt identity and calls reconciliation. It never creates a second
payment as an automatic network retry.

## Resource unlock failure

A settled payment and a failed HTTP content response are separate outcomes. After settlement, retry
only the protected-resource unlock using the merchant's stored challenge/payment status. Do not pay
again.
