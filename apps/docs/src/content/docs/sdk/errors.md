---
title: Handle errors
description: Branch on stable SDK error codes without unsafe retries.
---

`AgentAllowanceError` exposes a stable `code`, optional `attemptId`, and optional `safeDetail`.

```ts
import { AgentAllowanceError } from "@agentallowance/sdk";

try {
  await aa.fetch(url, { allowanceId });
} catch (error) {
  if (!(error instanceof AgentAllowanceError)) throw error;

  switch (error.code) {
    case "SETTLEMENT_UNKNOWN":
      await aa.reconcile(error.attemptId!);
      break;
    case "BUDGET_EXCEEDED":
    case "RECIPIENT_NOT_ALLOWED":
    case "ALLOWANCE_EXPIRED":
      console.log("Payment denied by policy", error.code);
      break;
    default:
      throw error;
  }
}
```

## Retry categories

| Category | Codes | Correct response |
| --- | --- | --- |
| Policy denial | `BUDGET_EXCEEDED`, `RECIPIENT_NOT_ALLOWED`, `ALLOWANCE_EXPIRED`, `ALLOWANCE_REVOKED` | Do not retry unchanged terms |
| Configuration | `NETWORK_MISMATCH`, `ASSET_NOT_ALLOWED`, `SIGNER_NOT_AUTHORIZED`, `CONFIGURATION_ERROR` | Correct deployment or client config |
| Invalid challenge | `MALFORMED_CHALLENGE`, `UNSUPPORTED_SCHEME`, `UNSUPPORTED_CALL` | Merchant must issue supported terms |
| Definitive verification failure | `FACILITATOR_REJECTED`, `RECEIPT_MISMATCH` | Inspect and reject |
| Ambiguous settlement | `SETTLEMENT_UNKNOWN` | Reconcile the same attempt |
| Unlock failure | `RESOURCE_UNLOCK_FAILED` | Retry unlock, not payment |
| Duplicate | `DUPLICATE_ATTEMPT` | Load or reconcile the existing attempt |

`safeDetail` is designed for operator diagnostics but should still be reviewed before exposing it to
untrusted clients. It never contains signer secrets or raw credentials.

See the [complete error code reference](/reference/error-codes/).
