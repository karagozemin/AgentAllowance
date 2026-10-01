# @agentallowance/sdk

Give AI agents a budget, not your wallet.

`@agentallowance/sdk` is the server-side TypeScript SDK for bounded, autonomous x402 payments on
Stellar. It creates and revokes smart-account allowances, validates payment challenges, constructs
delegated Soroban authorization, verifies settlement receipts, and keeps normalized evidence for
reconciliation.

> Testnet-first, unaudited software. Do not use this release for production custody.

## Install

```bash
npm install @agentallowance/sdk @stellar/stellar-sdk
```

Node.js 22.18 or newer is required. The default evidence store uses `node:sqlite`, so this package is
intended for trusted server or agent runtimes, not browser bundles.

The pinned Stellar SDK has an upstream `@stellar/js-xdr` declaration gap. TypeScript consumers should
enable `skipLibCheck: true`; application source remains strictly checked.

## Pay an x402 service

```ts
import { AgentAllowance, SqliteEvidenceStore } from "@agentallowance/sdk";
import { Keypair } from "@stellar/stellar-sdk";

const delegate = Keypair.fromSecret(process.env.DELEGATED_SIGNER_SECRET!);
const feePayer = Keypair.fromSecret(process.env.FEE_PAYER_SECRET!);

const aa = new AgentAllowance({
  network: "stellar:testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  assetContract: process.env.STELLAR_TOKEN_CONTRACT!,
  treasuryContract: process.env.TREASURY_CONTRACT!,
  spendingPolicy: process.env.SPENDING_POLICY_CONTRACT!,
  recipientPolicy: process.env.RECIPIENT_POLICY_CONTRACT!,
  facilitatorUrl: process.env.X402_FACILITATOR_URL!,
  transactionSource: feePayer,
  adminAddress: process.env.ADMIN_ADDRESS!,
  delegatedSigners: { [delegate.publicKey()]: delegate },
  store: new SqliteEvidenceStore("./data/agentallowance.db"),
});

const response = await aa.fetch("https://merchant.example/premium", {
  allowanceId: "2",
});

console.log(await response.json());
```

`fetch` performs the complete `402 -> authorization -> verify -> settle -> paid retry` lifecycle. It
accepts the protected response only when the settlement receipt matches the original network, payer,
asset, amount, recipient, and challenge reference.

## Core API

```ts
await aa.allowances.create(input);
await aa.allowances.get(id);
await aa.allowances.list();
await aa.allowances.revoke(id);
await aa.treasury.balance();

aa.preflight(requirements, allowance, currentLedger);
await aa.pay(challenge, { allowanceId });
await aa.fetch(url, { allowanceId });
await aa.reconcile(attemptId);
aa.getAttempt(attemptId);
aa.listAttempts();
```

Administration can use a backend-held admin signer or the exported wallet preparation/submission
functions for exact Freighter authorization preimages. Delegated payment keys and fee-payer keys must
remain in isolated server-side signer processes.

## Typed failures

```ts
import { AgentAllowanceError } from "@agentallowance/sdk";

try {
  await aa.fetch(url, { allowanceId: "2" });
} catch (error) {
  if (error instanceof AgentAllowanceError) {
    console.error(error.code, error.attemptId, error.safeDetail);
  }
}
```

Stable codes distinguish policy denials, malformed challenges, definitive facilitator rejection,
ambiguous settlement, receipt mismatch, and protected-resource failure. An ambiguous settlement must
be reconciled; it must not be paid again blindly.

## Documentation

- [Five-minute overview and quickstart](https://github.com/karagozemin/AgentAllowance/blob/main/docs/sdk/quickstart.md)
- [API reference](https://github.com/karagozemin/AgentAllowance/blob/main/docs/sdk/api-reference.md)
- [Error reference](https://github.com/karagozemin/AgentAllowance/blob/main/docs/sdk/errors.md)
- [SDK security model](https://github.com/karagozemin/AgentAllowance/blob/main/docs/sdk/security.md)
- [Independent integration example](https://github.com/karagozemin/AgentAllowance/tree/main/apps/x402-sdk-example)
- [Testnet evidence](https://github.com/karagozemin/AgentAllowance/blob/main/docs/submission/evidence-index.md)

MIT licensed.
