# AgentAllowance SDK

`@agentallowance/sdk` turns a Stellar smart-account allowance into a server-side payment primitive for
AI agents. The SDK is deliberately narrow: it administers bounded permissions and completes strict
x402 payments. It is not a general wallet, custody platform, or browser signing library.

## Choose a guide

- [Quickstart](quickstart.md): configure a delegated payer and unlock an x402 resource.
- [API reference](api-reference.md): methods, input types, records, and wallet-admin functions.
- [Errors](errors.md): stable reason codes and correct retry behavior.
- [Security](security.md): key roles, trust boundaries, and fail-closed behavior.
- [Publishing](publishing.md): tarball gates, npm authentication, and release order.
- [Runnable example](../../apps/x402-sdk-example/README.md): independent workspace consumer.

## Lifecycle

```text
HTTP request
  -> 402 challenge
  -> exact network/asset/recipient/amount validation
  -> local policy preflight
  -> delegated Soroban authorization
  -> facilitator verify and settlement
  -> receipt binding
  -> paid retry and protected response
```

The Stellar C-account remains the payer. The delegate can authorize only the invocation selected by
its active on-chain context rule; the fee payer can sponsor submission but cannot bypass that policy.

## Package support

- Runtime: Node.js 22.18+
- Module format: ESM
- Network proven by this release: Stellar Testnet
- Asset proven by the submission: official Testnet USDC SAC
- Storage included: SQLite evidence store, with an injectable `EvidenceStore` interface
- License: MIT

This release is unaudited and not intended for production custody.
