# Technical Verification

This document keeps implementation, dependency, and verification detail outside the reviewer-first
root README.

## Pinned versions

```text
OpenZeppelin stellar-accounts  0.7.2
Soroban SDK                    26.1.0
Stellar JavaScript SDK         16.2.0
OpenZeppelin facilitator base  100ccec1dcb597544a215f749796870e03c63c45
```

`Cargo.lock` pins `ed25519-dalek` to `2.2.0`. The upstream Soroban host currently declares
`>=2.0.0`, which otherwise resolves to incompatible `3.0.0`.

## Verification portfolio

| Security surface | Checks | What it proves |
| --- | ---: | --- |
| Policy-aware x402 facilitator | **124** | Strict transfer/auth validation, settlement, replay boundaries, Relayer isolation, and malicious-input rejection |
| Smart-account policy validator | **26** | Manifest-pinned WASM identity, two-entry delegated auth, and exact policy-event validation |
| SDK and product flows | **39** | Treasury administration, merchant `402` lifecycle, console owner operations, funding, sessions, and reconciliation |
| Auth, payer, and shared primitives | **9** | Authorization construction, receipt binding, reason codes, and deterministic payload handling |
| Soroban contracts | **3** | Spending limit, recipient restriction, expiry, and revoke behavior |
| Desktop/mobile browser E2E | **11** | Public demo, wallet-owner routes, session restoration, Freighter lifecycle, docs navigation, search, and responsive layout |
| **Total** | **212** | Unit, integration, contract, and browser-level verification |

The TypeScript tests consume the compatibility proof's real transaction and simulation XDR. They
confirm that the policy-aware validator accepts the proven payment while rejecting unapproved code,
unrelated or duplicate events, duplicate transfers, unsuccessful calls, code-hash mismatches, extra
authorization entries, and mutated payment fields.

## Local verification

Prerequisites: Node.js 22.18+, pnpm 10+, Rust 1.84+, `wasm32v1-none`, and Stellar CLI 27+.

```bash
pnpm install
pnpm typecheck
pnpm test
cargo test --workspace
stellar contract build
pnpm --filter @agentallowance/console test:e2e
pnpm --filter @agentallowance/docs test:e2e
pnpm --filter @agentallowance/x402-sdk-example typecheck
```

The timed clean-environment path is `scripts/quickstart-testnet.sh`. It keeps the merchant and console
processes separate so a failed service cannot be hidden inside a shell pipeline. The recorded hosted
runner and warm-cache results are in
[quickstart-benchmark.md](../submission/quickstart-benchmark.md); the clean runner completed the full
CI verification in 71 seconds.

## Complete local product

Prepare and start the local OpenZeppelin Relayer. Generated API keys, keystores, and passphrases stay
under ignored `artifacts/local/` paths.

```bash
pnpm run relayer:prepare
pnpm run relayer:start
```

Load the runtime environment, then start the merchant API and console in separate terminals:

```bash
set -a; source artifacts/local/relayer/latest.env; set +a
pnpm --filter @agentallowance/x402-demo-api start
```

```bash
set -a; source artifacts/local/relayer/latest.env; set +a
pnpm --filter @agentallowance/console build
pnpm --filter @agentallowance/console start
```

Open `http://127.0.0.1:3000`. The merchant API listens on `http://127.0.0.1:3001`.

For a new Testnet deployment, official USDC preparation, or manual settlement, follow the
[facilitator integration guide](../openzeppelin-facilitator-integration.md). For hosted services, use
the [Render deployment guide](../../deploy/render/README.md). Settlement remains an explicit operator
action and must follow review of the exact payer, token, amount, recipient, facilitator response, and
transaction envelope.

## Licensing boundary

Application and contract code is MIT-licensed. The upstream-derived
`packages/relayer-plugin-x402-facilitator` remains AGPL-3.0-only and retains OpenZeppelin attribution;
review that package's `LICENSE` before redistribution.
