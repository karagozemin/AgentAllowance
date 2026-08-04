---
title: Packages
description: Public npm packages, responsibility boundaries, and installation guidance.
---

AgentAllowance publishes four MIT-licensed developer-preview packages at version `0.1.1`.

## `@agentallowance/sdk`

Application-level client for treasury deployment, allowances, x402 payment, evidence, reconciliation,
and wallet-owned administration.

```bash
npm install @agentallowance/sdk @stellar/stellar-sdk
```

[View on npm](https://www.npmjs.com/package/@agentallowance/sdk)

## `@agentallowance/x402-payer`

Strict Stellar x402 challenge parsing, smart-account payment construction, facilitator client, and
receipt binding. Use it when building a custom payment orchestrator instead of the full SDK.

```bash
npm install @agentallowance/x402-payer @stellar/stellar-sdk
```

[View on npm](https://www.npmjs.com/package/@agentallowance/x402-payer)

## `@agentallowance/stellar-smart-account-auth`

Low-level two-entry Soroban authorization builders and validators for delegated OpenZeppelin smart
accounts.

```bash
npm install @agentallowance/stellar-smart-account-auth @stellar/stellar-sdk
```

[View on npm](https://www.npmjs.com/package/@agentallowance/stellar-smart-account-auth)

## `@agentallowance/shared`

Shared x402 types, policy reason codes, stable hashes, atomic amount parsing, service URL validation,
and payment payload encoding.

```bash
npm install @agentallowance/shared
```

[View on npm](https://www.npmjs.com/package/@agentallowance/shared)

## Version policy

All four packages currently move together. Pin compatible versions rather than mixing releases:

```json
{
  "dependencies": {
    "@agentallowance/sdk": "0.1.1",
    "@stellar/stellar-sdk": "16.2.0"
  }
}
```

The policy-aware OpenZeppelin Relayer plugin remains in the repository because it derives from an
AGPL-3.0-only upstream package. Review its license before redistribution.
