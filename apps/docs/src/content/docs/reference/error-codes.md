---
title: Typed error codes
description: Complete AgentAllowanceError code reference and required operator response.
---

| Code | Meaning | Correct response |
| --- | --- | --- |
| `NETWORK_MISMATCH` | Challenge requests another network | Reject and correct configuration |
| `ASSET_NOT_ALLOWED` | Asset is outside allowance scope | Reject |
| `RECIPIENT_NOT_ALLOWED` | `payTo` is not approved | Reject or create a new rule |
| `BUDGET_EXCEEDED` | Amount exceeds remaining rolling budget | Wait for reset or create a new rule |
| `ALLOWANCE_EXPIRED` | Ledger expiry has passed | Create a new allowance |
| `ALLOWANCE_REVOKED` | Context rule was removed | Create a new allowance |
| `ALLOWANCE_NOT_FOUND` | Evidence record is missing | Correct the allowance ID/store |
| `ALLOWANCE_NOT_ACTIVE` | Rule is exhausted or errored | Inspect chain state |
| `SIGNER_NOT_AUTHORIZED` | Delegate does not match the rule | Use the configured signer |
| `SCOPE_NOT_ALLOWED` | Invocation is outside allowed call scope | Reject |
| `MALFORMED_CHALLENGE` | Required x402 data is invalid | Merchant must correct the challenge |
| `UNSUPPORTED_SCHEME` | Payment is not supported x402 v2 `exact` | Reject |
| `FACILITATOR_REJECTED` | Verification definitively failed | Inspect reason before retry |
| `SETTLEMENT_UNKNOWN` | Submission outcome is ambiguous | Reconcile; never pay blindly |
| `RECEIPT_MISMATCH` | Receipt differs from signed terms | Reject protected response |
| `RESOURCE_UNLOCK_FAILED` | Payment settled but content did not unlock | Retry unlock, not payment |
| `DUPLICATE_ATTEMPT` | Request reference already has an attempt | Load or reconcile existing attempt |
| `UNSUPPORTED_CALL` | Soroban invocation shape is not allowed | Reject |
| `CONFIGURATION_ERROR` | SDK or allowance input is invalid | Fix configuration |

## Error shape

```ts
type AgentAllowanceError = Error & {
  code: PolicyReason;
  attemptId?: string;
  safeDetail?: string;
};
```

Use `code` for control flow. Use `attemptId` to inspect or reconcile evidence. Treat `safeDetail` as
operator-facing diagnostic context, not trusted public UI copy.
