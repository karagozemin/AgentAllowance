---
title: Pay an x402 endpoint
description: Use fetch or pay to authorize, settle, and verify a bounded payment.
---

## Use `fetch()` for the complete HTTP flow

```ts
const response = await aa.fetch("https://merchant.example/premium", {
  allowanceId: "2",
  request: {
    method: "GET",
    headers: { Accept: "application/json" },
  },
  signal: AbortSignal.timeout(30_000),
});

const resource = await response.json();
```

The SDK performs these operations:

1. requests the protected resource;
2. parses and validates the x402 v2 challenge;
3. reserves an idempotent payment attempt;
4. refreshes allowance state from chain;
5. builds and signs delegated smart-account authorization;
6. runs enforcing Soroban simulation;
7. retries with `PAYMENT-SIGNATURE`;
8. validates `PAYMENT-RESPONSE` against the original terms;
9. returns the unlocked response.

## Use `pay()` when HTTP is managed elsewhere

```ts
const receipt = await aa.pay(paymentRequired, {
  allowanceId: "2",
});
```

`pay()` accepts parsed `PaymentRequired`, settles it, and returns a bound receipt. It does not retry
the protected resource request.

## Preflight without settlement

```ts
const decision = aa.preflight(requirements, allowance, currentLedger);
if (!decision.allowed) {
  console.error(decision.reason, decision.detail);
}
```

Preflight is useful for operator feedback. It is not authoritative and must never replace enforcing
simulation or facilitator verification.

## Inspect the attempt

```ts
const attempts = aa.listAttempts(10);
const attempt = aa.getAttempt(attempts[0]!.attemptId);
```

An attempt records the challenge hash, exact payer terms, lifecycle state, policy decision, reason
code, transaction hash, receipt, and receipt hash. Secret keys and facilitator credentials are not
stored in the attempt.
