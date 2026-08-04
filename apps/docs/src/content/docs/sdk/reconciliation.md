---
title: Reconcile settlement
description: Resolve ambiguous network outcomes without paying twice.
---

Distributed payment systems have an unavoidable ambiguous case: the settlement transaction may have
been submitted even though the client did not receive a final response. AgentAllowance represents
this as `SETTLEMENT_UNKNOWN` instead of treating it as a normal failure.

## Never retry blindly

```ts
try {
  await aa.fetch(url, { allowanceId });
} catch (error) {
  if (error instanceof AgentAllowanceError &&
      error.code === "SETTLEMENT_UNKNOWN" &&
      error.attemptId) {
    const reconciled = await aa.reconcile(error.attemptId);
    console.log(reconciled.state, reconciled.txHash);
    return;
  }
  throw error;
}
```

`reconcile()` checks the merchant payment-status endpoint using the original attempt identity. It
does not create a new authorization or submit another payment.

## State handling

| Reconciled state | Meaning | Next action |
| --- | --- | --- |
| `SETTLED` | Payment has a valid receipt | Retry protected-resource unlock only |
| `UNLOCKED` | Payment and resource delivery completed | Return the stored result |
| `UNKNOWN` | The external system is still ambiguous | Wait and reconcile again |
| `BLOCKED` | A definitive policy or verification denial exists | Do not retry unchanged terms |

## Storage requirement

Persist evidence before any external submission. The built-in SQLite store is suitable for a
single-instance demo. Production systems need a durable transactional database with a unique
allowance/request-reference constraint so concurrent workers cannot create duplicate payments.
