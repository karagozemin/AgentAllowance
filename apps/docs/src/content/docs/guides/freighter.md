---
title: Freighter administration
description: Connect a wallet, deploy its treasury, and sign exact allowance mutations.
---

Freighter is used for treasury ownership and administration. It is not asked to sign autonomous
agent payments. The delegated signer handles payments after the owner creates an allowance.

## 1. Prove wallet ownership

Request access and verify that Freighter is on Stellar Testnet:

```ts
import { getNetworkDetails, requestAccess, signMessage } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

const access = await requestAccess();
if (access.error || !access.address) throw new Error("Wallet access rejected");

const network = await getNetworkDetails();
if (network.networkPassphrase !== Networks.TESTNET) {
  throw new Error("Switch Freighter to Stellar Testnet");
}
```

Ask the backend for a single-use login challenge, sign it, and return the signature:

```ts
const challenge = await fetch(`/api/owner/challenge?address=${access.address}`)
  .then((response) => response.json());

const signed = await signMessage(challenge.message, { address: access.address });

await fetch("/api/owner/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    nonce: challenge.nonce,
    address: access.address,
    signature: signed.signedMessage,
  }),
});
```

The hosted console creates a signed, HttpOnly, SameSite session cookie after SEP-53 message
verification. It is valid for 24 hours and survives a service restart. A session proves identity but
cannot mutate on-chain rules without a fresh Freighter authorization signature.

## 2. Deploy the deterministic treasury

Call `POST /api/owner/onboard` after login. The fee sponsor submits a create-contract transaction,
but the constructor assigns rule `0` admin to the connected wallet.

The deployment salt binds:

- network passphrase;
- wallet owner;
- fee sponsor;
- treasury WASM hash;
- asset and policy contracts;
- deployment version.

The same inputs always produce the same C-account address. The owner address is never accepted from
an onboarding request body; it comes from the verified session.

## 3. Prepare an allowance

```ts
const prepared = await fetch("/api/owner/allowances/prepare", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    label: "research-agent",
    delegatedSigner: "G...",
    maxSpendAtomic: "1000000",
    windowSeconds: 3600,
    recipient: "G...",
    expiresInSeconds: 86400,
  }),
}).then((response) => response.json());
```

The server stores a one-time operation for 60 seconds and returns only the canonical Stellar
authorization preimage.

## 4. Authorize in Freighter

```ts
import { signAuthEntry } from "@stellar/freighter-api";

const signed = await signAuthEntry(prepared.authPreimageXdr, {
  address: access.address,
  networkPassphrase: Networks.TESTNET,
});

if (signed.error || !signed.signedAuthEntry) {
  throw new Error("Authorization rejected");
}
```

Submit the signature with the operation ID:

```ts
const allowance = await fetch("/api/owner/allowances/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    operationId: prepared.operationId,
    walletSignature: signed.signedAuthEntry,
  }),
}).then((response) => response.json());
```

The backend revalidates the signer address, network, nonce, expiry, invocation, auth tree, and
signature before enforcing simulation and fee-payer submission.

## Revoke

Revocation uses the same two-phase pattern:

```text
POST /api/owner/allowances/:id/revoke/prepare
POST /api/owner/allowances/revoke/submit
```

The revoked rule can no longer authorize payments. Other allowance rules remain unchanged.
