# SDK Error Reference

`AgentAllowanceError` exposes a stable `code`, optional `attemptId`, and optional `safeDetail`.

| Code | Meaning | Correct response |
| --- | --- | --- |
| `NETWORK_MISMATCH` | Challenge requests another network | Reject |
| `ASSET_NOT_ALLOWED` | Asset is outside allowance scope | Reject |
| `RECIPIENT_NOT_ALLOWED` | `payTo` is not approved | Reject or create a new rule |
| `BUDGET_EXCEEDED` | Amount exceeds remaining rolling budget | Wait for reset or create a new rule |
| `ALLOWANCE_EXPIRED` | Ledger expiry has passed | Create a new allowance |
| `ALLOWANCE_REVOKED` | Context rule was removed | Create a new allowance |
| `ALLOWANCE_NOT_FOUND` | Local evidence record is missing | Correct configuration |
| `ALLOWANCE_NOT_ACTIVE` | Allowance is draft, exhausted, or errored | Inspect chain state |
| `SIGNER_NOT_AUTHORIZED` | Delegate does not match the rule | Use the configured signer |
| `SCOPE_NOT_ALLOWED` | Invocation is outside the rule | Reject |
| `MALFORMED_CHALLENGE` | Required x402 data is invalid | Service must correct challenge |
| `UNSUPPORTED_SCHEME` | Challenge is not supported `exact` x402 v2 | Reject |
| `FACILITATOR_REJECTED` | Verification definitively failed | Inspect reason before retry |
| `SETTLEMENT_UNKNOWN` | Submission outcome is ambiguous | Reconcile; never pay blindly |
| `RECEIPT_MISMATCH` | Receipt differs from signed terms | Reject protected response |
| `RESOURCE_UNLOCK_FAILED` | Settlement succeeded but content did not unlock | Retry unlock, not payment |
| `DUPLICATE_ATTEMPT` | Request reference already has an attempt | Load or reconcile existing attempt |
| `UNSUPPORTED_CALL` | Soroban invocation shape is not allowed | Reject |
| `CONFIGURATION_ERROR` | SDK or allowance input is invalid | Fix configuration |

## Example

```ts
try {
  await aa.fetch(url, { allowanceId });
} catch (error) {
  if (!(error instanceof AgentAllowanceError)) throw error;

  if (error.code === "SETTLEMENT_UNKNOWN" && error.attemptId) {
    await aa.reconcile(error.attemptId);
  }
}
```

`safeDetail` is suitable for operator diagnostics but should still be reviewed before exposing it to
untrusted clients. Secret keys and raw credentials are never included in SDK error objects.
