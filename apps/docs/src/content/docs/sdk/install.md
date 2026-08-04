---
title: Install and configure
description: Runtime requirements, package installation, client configuration, and secret boundaries.
---

## Runtime

The SDK is an ESM package for Node.js 22.18 or newer. It uses `node:sqlite` for its built-in evidence
store and is intentionally not browser-safe.

```bash
npm install @agentallowance/sdk @stellar/stellar-sdk
```

The main package re-exports shared types and reason codes. Install the lower-level packages only when
you are building a custom authorization or payment pipeline.

## TypeScript

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  }
}
```

`skipLibCheck` works around missing declarations in an upstream Stellar dependency. It does not
disable checking in your application source.

## Configuration

```ts
import { AgentAllowance, SqliteEvidenceStore } from "@agentallowance/sdk";

const aa = new AgentAllowance({
  network: "stellar:testnet",
  rpcUrl,
  horizonUrl,
  assetContract,
  treasuryContract,
  spendingPolicy,
  recipientPolicy,
  facilitatorUrl,
  facilitatorApiKey,
  transactionSource: feePayerKeypair,
  adminAddress,
  delegatedSigners: {
    [delegate.publicKey()]: delegate,
  },
  store: new SqliteEvidenceStore("./data/evidence.db"),
});
```

| Field | Required | Purpose |
| --- | --- | --- |
| `network` | Yes | `stellar:testnet` or `stellar:pubnet` |
| `rpcUrl` | Yes | Soroban RPC used for simulation and reads |
| `horizonUrl` | No | Defaults to the selected network |
| `assetContract` | Yes | SEP-41 asset contract allowed by the treasury |
| `treasuryContract` | Yes | Smart C-account that pays |
| `spendingPolicy` | Yes | OpenZeppelin spending-limit policy contract |
| `recipientPolicy` | Yes | Exact-recipient policy contract |
| `facilitatorUrl` | Yes | Policy-aware x402 facilitator endpoint |
| `facilitatorApiKey` | No | Server-only facilitator credential |
| `transactionSource` | Yes | Fee-payer `Keypair` |
| `adminAddress` | For admin flows | Wallet address that owns rule `0` |
| `adminSigner` | No | Backend admin fallback; avoid for wallet custody |
| `delegatedSigners` | Yes | Public-key to delegated `Keypair` map |
| `store` | No | Custom `EvidenceStore` implementation |
| `databasePath` | No | SQLite path when `store` is omitted |

## Secret boundary

Keep these values server-side:

- delegated signer secrets;
- fee-payer secrets;
- facilitator API keys;
- optional backend admin signer.

Freighter administration does not send the owner secret to your backend. The backend prepares a
canonical Stellar authorization preimage, and the wallet returns only the signature.
