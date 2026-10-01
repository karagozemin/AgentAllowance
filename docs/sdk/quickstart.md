# SDK Quickstart

This quickstart connects a delegated signer to an existing AgentAllowance Testnet treasury and pays an
x402-protected endpoint. It does not create a production wallet or hide signer custody.

## 1. Install

Use Node.js 22.18 or newer in an ESM project.

```bash
npm install @agentallowance/sdk @stellar/stellar-sdk dotenv
```

The pinned Stellar SDK currently imports `@stellar/js-xdr`, which does not publish TypeScript
declarations. Set `skipLibCheck: true` in `tsconfig.json`; your application code remains strictly
checked while TypeScript skips that upstream declaration gap.

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  }
}
```

## 2. Configure

Create `.env` with values from your deployment. Never commit this file.

```dotenv
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

The delegated secret authorizes only its allowance. The fee payer sponsors transaction submission.
Neither key belongs in browser code.

## 3. Pay and unlock

```ts
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

try {
  const response = await aa.fetch(required("PAID_URL"), {
    allowanceId: required("ALLOWANCE_ID"),
  });
  console.log(await response.text());
} catch (error) {
  if (error instanceof AgentAllowanceError) {
    console.error({ code: error.code, attemptId: error.attemptId, detail: error.safeDetail });
  }
  throw error;
}
```

Run the compiled program. A successful response is returned only after the receipt matches the signed
challenge. Inspect the attempt afterward:

```ts
const attempts = aa.listAttempts(10);
console.log(attempts[0]);
```

## 4. Handle ambiguity correctly

If the SDK throws `SETTLEMENT_UNKNOWN`, do not issue another payment. Persist the `attemptId` and call:

```ts
const attempt = await aa.reconcile(error.attemptId!);
```

Only retry payment after reconciliation proves no settlement exists.

## 5. Run the repository example

The independent integration under [`apps/x402-sdk-example`](../../apps/x402-sdk-example/README.md)
uses only the SDK and the merchant HTTP endpoint. It is the reference environment template and the
cleanest way to reproduce the full Testnet flow from this repository.
