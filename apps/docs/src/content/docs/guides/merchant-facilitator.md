---
title: Merchant and facilitator
description: Issue x402 challenges and settle policy-controlled Stellar smart-account payments.
---

AgentAllowance keeps the merchant, facilitator, and payer responsibilities separate. The merchant
owns challenge and protected-resource state. The facilitator validates and submits the transaction.

## Merchant flow

For an unpaid request, return x402 v2 requirements containing exact terms:

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "amount": "100000",
      "payTo": "GDYGNUG2DKQVRJYYMXO5AUFEMMEMW7NIOGCQZSVYVNVMS4GNROZYJ5SZ",
      "maxTimeoutSeconds": 60,
      "extra": {
        "challengeId": "merchant-generated-unique-id"
      }
    }
  ]
}
```

Persist the challenge before returning `402`. Bind its identity to amount, recipient, asset, network,
resource, and expiry.

## Paid retry

The retry carries `PAYMENT-SIGNATURE`. Before settlement:

1. decode the x402 payload;
2. compare it with the stored challenge;
3. atomically claim the challenge for one in-flight settlement;
4. call facilitator verification;
5. settle only after `isValid: true`;
6. persist the transaction and receipt;
7. return the protected resource with `PAYMENT-RESPONSE`.

Do not let the payer choose a facilitator URL, asset, recipient, or settlement method in the paid
request.

## Facilitator endpoint

The hosted integration uses the OpenZeppelin Relayer plugin call endpoint:

```text
POST /api/v1/plugins/x402-facilitator/call
```

The merchant calls its `verify` and `settle` actions with a server-side bearer credential. Never put
the facilitator API key in browser code.

## Policy-aware verification

The verifier retains canonical x402 checks and adds a narrow smart-account path. It requires:

- one top-level SEP-41 transfer with no sub-invocations;
- the smart C-account as `from` and x402 payer;
- exactly two address-auth entries;
- a bounded, unexpired authorization;
- treasury WASM matching the approved manifest;
- one matching transfer event;
- one matching `spending_limit_enforced` event from the pinned policy contract;
- recipient-policy state matching token and recipient;
- no unknown, duplicate, malformed, or spoofed events.

An ALLOW result from local SDK preflight cannot bypass these checks.

## Idempotency

Use a unique constraint over merchant challenge identity and payer attempt reference. If settlement is
submitted but the response is lost, keep the challenge in a pending state and expose a payment-status
endpoint for reconciliation. Do not release the claim and accept a second payment blindly.
