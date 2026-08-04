<p align="center">
  <img src="docs/assets/agentallowance-logo.jpg" alt="AgentAllowance" width="150" />
</p>

<h1 align="center">AgentAllowance</h1>

<p align="center">
  <strong>Give AI agents a budget, not your wallet.</strong>
</p>

<p align="center">
  Autonomous, policy-controlled x402 payments on Stellar.
</p>

<p align="center">
  <a href="https://agentallowance-console.onrender.com/"><strong>Launch Live Demo</strong></a> ·
  <a href="docs/submission/demo-runbook.md">90-second Judge Flow</a> ·
  <a href="docs/submission/evidence-index.md">Testnet Evidence</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/sdk/README.md">SDK Docs</a>
</p>

<p align="center">
  <img alt="Stellar Testnet" src="https://img.shields.io/badge/Stellar-Testnet-111111" />
  <img alt="Official Testnet USDC" src="https://img.shields.io/badge/USDC-Testnet-2775CA" />
  <img alt="x402 v2" src="https://img.shields.io/badge/x402-v2-1f8f75" />
  <img alt="Checks passing" src="https://img.shields.io/badge/checks-201_passing-20a878" />
  <a href="https://www.npmjs.com/package/@agentallowance/sdk"><img alt="npm SDK" src="https://img.shields.io/badge/npm-%40agentallowance%2Fsdk-CB3837" /></a>
</p>

AgentAllowance lets a Stellar wallet owner give an AI agent a bounded payment permission instead of
unrestricted access to the wallet. The owner defines the spending limit, approved recipient, token,
rolling window, and expiry once. The delegated agent can then complete x402 payments autonomously
while a Stellar smart account enforces every restriction on-chain.

The smart C-account is the real x402 payer. Owners do not sign every payment, treasury keys are never
shared with agents, and a policy-aware facilitator validates the exact SEP-41 transfer before an
OpenZeppelin Relayer settles it.

> **AgentAllowance completes the missing path between constrained smart-account authorization and
> real Stellar x402 settlement.**

## Try the judge flow

The public demo requires no password or wallet setup.

1. Run an approved AI-agent payment.
2. Watch Testnet USDC settle and unlock the protected resource.
3. Attempt an over-limit payment and see it fail without moving funds.
4. Attempt payment to an unapproved recipient and see it fail.
5. Inspect the transaction, policy decision, authorization entries, and state changes.

A Testnet Freighter wallet can also create its own smart-account treasury, create or revoke bounded
allowances, and then let its delegated agent pay autonomously.

## Proven on Stellar Testnet

| Scenario | Result |
| --- | --- |
| Approved 0.01 USDC x402 payment | Settled and protected resource unlocked |
| Spending limit exceeded | Blocked; no settlement |
| Recipient not approved | Blocked; no settlement |
| Wallet-owned treasury onboarding | Deployed with the connected wallet as on-chain admin |
| Delegated autonomous payment | Completed without the owner signing the payment |
| Evidence | Transaction hash, XDR, simulation, policy state, and receipts archived |

**Official Testnet USDC transaction:**
[`11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3`](https://stellar.expert/explorer/testnet/tx/11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3)

**Hosted wallet-owner settlement:**
[`449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d`](https://stellar.expert/explorer/testnet/tx/449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d)

Every product claim maps to an append-only artifact in the
[reviewer evidence index](docs/submission/evidence-index.md).

## Why this matters for Stellar

x402 gives agents a standard way to pay for online resources, but giving an autonomous agent an
unrestricted wallet key is unsafe. Stellar Smart Accounts can constrain authorization, yet
policy-controlled transactions introduce additional authorization and policy evidence that strict
facilitators must validate correctly.

AgentAllowance provides the integration layer:

- Smart C-account as the x402 payer
- Delegated agent authorization without per-payment owner signatures
- On-chain spending, recipient, token, rolling-window, and expiry restrictions
- Exact SEP-41 transfer and Soroban authorization validation
- Policy-aware facilitator verification that remains fail-closed
- Successful payment and denial evidence on official Testnet USDC
- Reusable SDK and facilitator components for other Stellar developers

## How it works

```text
Owner sets bounded permission
        |
        v
Agent receives HTTP 402 -> Smart account enforces policy
        |
        v
Facilitator verifies transfer + approved policy evidence
        |
        v
OpenZeppelin Relayer settles -> Protected resource unlocks
```

The owner signs only treasury administration. The delegated agent signs payment authorization within
the active rule. The facilitator reconstructs and simulates the exact invocation, validates the
two-entry delegated authorization and approved policy event, and submits only after all checks pass.

See [architecture and trust boundaries](docs/architecture.md) for the complete component and sequence
diagrams.

## Product surfaces

| Surface | What it does |
| --- | --- |
| Public demo | Runs fixed approved and blocked scenarios without exposing arbitrary payment input |
| Wallet owner console | Creates a deterministic treasury and Freighter-signed allowances or revocations |
| Autonomous agent | Completes the `402 -> verify -> settle -> paid retry` flow without owner interaction |
| SDK | Embeds treasury administration, payer behavior, evidence, and reconciliation in another app |
| Facilitator extension | Accepts only manifest-pinned policy evidence while preserving strict x402 validation |

The independent [SDK example](apps/x402-sdk-example/README.md) consumes only
`@agentallowance/sdk` and the merchant HTTP endpoint; it does not import the console or deployment CLI.

## Integrate the SDK

The Node.js SDK exposes allowance administration, strict x402 payment, receipt binding, evidence, and
reconciliation through one typed API. Install the public `0.1.1` developer preview from npm:

```bash
npm install @agentallowance/sdk @stellar/stellar-sdk
```

Published manifests and tarballs are also validated in a clean consumer project with:

```bash
pnpm test:sdk-package
pnpm pack:sdk
```

Start with the [SDK quickstart](docs/sdk/quickstart.md), then use the
[API](docs/sdk/api-reference.md), [typed errors](docs/sdk/errors.md), and
[SDK security model](docs/sdk/security.md). The
[npm package](https://www.npmjs.com/package/@agentallowance/sdk) and independent workspace integration
expose the same typed surface.

## Security properties

- The treasury is a Stellar C-account; the AI agent never receives the owner's wallet key.
- Allowances bind signer, token, recipient, cap, rolling window, and ledger expiry on-chain.
- Freighter signs exact owner administration preimages for create and revoke operations.
- Payment authorization is short-lived, invocation-bound, and rejected on replay or mutation.
- Unexpected events, auth entries, contracts, WASM hashes, amounts, recipients, and nested invocations
  fail closed.
- The Relayer pays fees but cannot bypass treasury policy.

Read the full [security model](docs/security.md) and
[facilitator integration analysis](docs/openzeppelin-facilitator-integration.md).

## Verification

The repository currently passes **201 automated checks** across facilitator security, policy
validation, SDK and product flows, Soroban contracts, and desktop/mobile browser journeys.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:contracts
pnpm --filter @agentallowance/console test:e2e
```

| Surface | Checks |
| --- | ---: |
| Policy-aware x402 facilitator | 124 |
| Smart-account policy validator | 26 |
| SDK and product flows | 33 |
| Auth, payer, and shared primitives | 9 |
| Soroban contracts | 3 |
| Desktop/mobile browser E2E | 6 |
| **Total** | **201** |

Pinned versions, complete commands, and clean-runner results are in
[technical verification](docs/technical/verification.md).

## Repository map

| Path | Responsibility |
| --- | --- |
| `contracts/` | Treasury smart account, spending-limit wrapper, and recipient policy |
| `packages/sdk/` | Public application API, evidence store, and reconciliation |
| `packages/facilitator-policy/` | Exact auth, transfer, policy-event, and WASM validation |
| `packages/relayer-plugin-x402-facilitator/` | OpenZeppelin Relayer x402 integration |
| `apps/x402-demo-api/` | HTTP 402 merchant and protected resource |
| `apps/console/` | Public judge demo and wallet-owner application |
| `apps/testnet-cli/` | Reproducible Testnet deployment and evidence commands |

## Documentation

- [Documentation hub](docs/README.md)
- [SDK quickstart and API](docs/sdk/README.md)
- [90-second demo runbook](docs/submission/demo-runbook.md)
- [Reviewer evidence index](docs/submission/evidence-index.md)
- [Testnet settlement history](docs/evidence/settlement-history.md)
- [Architecture](docs/architecture.md)
- [Security model](docs/security.md)
- [Technical verification](docs/technical/verification.md)
- [Render deployment](deploy/render/README.md)
- [Submission readiness](docs/submission/checklist.md)

## Scope

This MVP is proven with the official Stellar Testnet USDC SAC. Multi-asset rules, MPP,
`recipient_policy_enforced`, threshold administration, and production custody are intentionally out
of scope. Public npm artifacts are published as a P1 developer preview. This is unaudited Testnet
software.

The repository application and contract code is MIT-licensed. The upstream-derived
`packages/relayer-plugin-x402-facilitator` retains its AGPL-3.0-only license and OpenZeppelin
attribution.
