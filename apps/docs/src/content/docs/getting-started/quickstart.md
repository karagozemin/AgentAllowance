---
title: 5-minute quickstart
description: Install the public SDK and make a bounded x402 payment on Stellar Testnet.
---

This guide connects a delegated signer to an existing AgentAllowance treasury and pays an
x402-protected endpoint. Run it in a trusted Node.js process. Delegated and fee-payer secrets must
never enter browser code.

## Prerequisites

- Node.js 22.18 or newer
- An ESM TypeScript project
- A funded Stellar Testnet treasury with an active allowance
- The matching delegated signer and a fee-payer account
- A policy-aware facilitator endpoint

## 1. Install

```bash
npm install @agentallowance/sdk @stellar/stellar-sdk dotenv
```

The Stellar SDK currently imports `@stellar/js-xdr`, which does not publish declarations. Keep your
application strict and skip only dependency declaration checking:

```json title="tsconfig.json"
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  }
}
```

## 2. Configure the environment

```dotenv title=".env"
PAID_URL=https://your-merchant.example/premium
ALLOWANCE_ID=2
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_TOKEN_CONTRACT=C...
TREASURY_CONTRACT=C...
SPENDING_POLICY_CONTRACT=C...
RECIPIENT_POLICY_CONTRACT=C...
X402_FACILITATOR_URL=https://your-facilitator.example/api/v1/plugins/x402-facilitator/call
ADMIN_ADDRESS=G...
DELEGATED_SIGNER_SECRET=S...
FEE_PAYER_SECRET=S...
```

Add `.env` to `.gitignore`. The delegated signer authorizes only the selected rule. The fee payer
sponsors submission; it does not own the treasury.

## 3. Create the client

```ts title="src/pay.ts"
import "dotenv/config";
import { AgentAllowance, AgentAllowanceError, SqliteEvidenceStore } from "@agentallowance/sdk";
import { Keypair } from "@stellar/stellar-sdk";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const delegate = Keypair.fromSecret(required("DELEGATED_SIGNER_SECRET"));
const feePayer = Keypair.fromSecret(required("FEE_PAYER_SECRET"));

const aa = new AgentAllowance({
  network: "stellar:testnet",
  rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  assetContract: required("STELLAR_TOKEN_CONTRACT"),
  treasuryContract: required("TREASURY_CONTRACT"),
  spendingPolicy: required("SPENDING_POLICY_CONTRACT"),
  recipientPolicy: required("RECIPIENT_POLICY_CONTRACT"),
  facilitatorUrl: required("X402_FACILITATOR_URL"),
  transactionSource: feePayer,
  adminAddress: required("ADMIN_ADDRESS"),
  delegatedSigners: { [delegate.publicKey()]: delegate },
  store: new SqliteEvidenceStore("./data/agentallowance.db"),
});
```

## 4. Pay and unlock

```ts
try {
  const response = await aa.fetch(required("PAID_URL"), {
    allowanceId: required("ALLOWANCE_ID"),
    signal: AbortSignal.timeout(30_000),
  });
  console.log(await response.text());
} catch (error) {
  if (error instanceof AgentAllowanceError) {
    console.error({
      code: error.code,
      attemptId: error.attemptId,
      detail: error.safeDetail,
    });
  }
  throw error;
}
```

`fetch()` performs the initial request, parses the x402 v2 challenge, validates the allowance,
constructs delegated Soroban authorization, settles through the facilitator, validates the receipt,
and returns the unlocked HTTP response.

## 5. Inspect evidence

```ts
const [latest] = aa.listAttempts(1);
console.log({
  state: latest?.state,
  decision: latest?.decision,
  transaction: latest?.txHash,
  receiptHash: latest?.receiptHash,
});
```

For a complete runnable consumer, use the repository's
[`apps/x402-sdk-example`](https://github.com/karagozemin/AgentAllowance/tree/main/apps/x402-sdk-example).

Next: [understand the payment lifecycle](/protocol/payment-lifecycle/) or [review error handling](/sdk/errors/).
