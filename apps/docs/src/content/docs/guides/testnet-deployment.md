---
title: Testnet deployment
description: Run the contracts, facilitator, merchant, console, and docs locally or on Render.
---

## Prerequisites

- Node.js 22.18+
- pnpm 10.13+
- Rust 1.92 with `wasm32v1-none`
- Stellar CLI 27+
- Docker for the local OpenZeppelin Relayer
- Stellar Testnet accounts and official Testnet USDC

## Verify the repository

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
cargo test --workspace --locked
stellar contract build
pnpm --filter @agentallowance/console test:e2e
```

## Prepare the local relayer

```bash
pnpm run relayer:prepare
pnpm run relayer:start
```

Generated keystore material and API keys remain under ignored `artifacts/local/` paths.

## Start product services

Load the generated environment and run the merchant:

```bash
set -a; source artifacts/local/relayer/latest.env; set +a
pnpm --filter @agentallowance/x402-demo-api start
```

In another terminal, run the console:

```bash
set -a; source artifacts/local/relayer/latest.env; set +a
pnpm --filter @agentallowance/console build
pnpm --filter @agentallowance/console start
```

The console listens on `http://127.0.0.1:3000`; the merchant listens on port `3001`.

Run the docs separately:

```bash
pnpm --filter @agentallowance/docs dev
```

## Render topology

The Blueprint defines four services:

| Service | Responsibility |
| --- | --- |
| `agentallowance-facilitator` | OpenZeppelin Relayer and policy-aware plugin |
| `agentallowance-demo-api` | x402 challenge, settlement claim, protected resource |
| `agentallowance-console` | Public proof mode and wallet-owner dApp |
| `agentallowance-docs` | Static developer documentation |

Redis backs the relayer queue. The current merchant and console SQLite paths are ephemeral and
suitable only for the hosted Testnet demo.

After changing `render.yaml`, sync the Blueprint and deploy facilitator, merchant, console, then docs.
All services intentionally use manual deploys so a new commit is not promoted without review.

## Sponsored owner funding

`OWNER_TREASURY_TARGET_BALANCE_ATOMIC` funds a new or rediscovered Testnet owner treasury up to a
bounded target. The Blueprint uses `1000000` atomic units, or `0.1 USDC`. Fund the fee-sponsor address
with official Testnet USDC; do not fund individual deterministic treasuries manually.
