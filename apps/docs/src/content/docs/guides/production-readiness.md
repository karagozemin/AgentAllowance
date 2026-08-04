---
title: Production readiness
description: Work required before moving from the proven Testnet implementation to production custody.
---

The current release is an unaudited developer preview. A green Testnet demo is not a production
custody approval.

## Required security work

- independent audits of the treasury, policy contracts, SDK authorization, and facilitator changes;
- threat modeling for your merchant, signer, relayer, RPC, and administrative environment;
- managed custody or HSM-backed delegated and fee-payer signing;
- threshold treasury administration, recovery, and key rotation;
- explicit contract upgrade and migration policy;
- dependency and WASM provenance controls.

## Required data work

Replace local SQLite with a shared transactional database that supports:

- atomic challenge claims;
- unique request references;
- durable payment attempts and receipts;
- cross-instance reconciliation;
- immutable audit exports;
- backup, restore, and retention policies.

## Required operations

- authenticated and rate-limited owner, merchant, facilitator, and operator endpoints;
- monitored RPC and Horizon providers with timeout and failover policy;
- metrics for verification denials, unknown settlements, relayer queue health, and treasury balances;
- alerting on code-hash changes, unexpected events, signer failures, and reconciliation backlog;
- incident response for compromised delegates, fee payers, merchant credentials, and sessions;
- capacity testing for relayer queues and Soroban simulation.

## Product scope decisions

The MVP intentionally supports one recipient per allowance, one delegated signer per allowance,
exact x402 v2 payments, and a pinned asset/policy deployment. Multi-asset rules, MPP, threshold admin,
and generalized policy event allowlists require separate design and review.

## Launch gate

Do not use `stellar:pubnet` merely because the SDK accepts the network value. Treat production as a
new deployment with independent contracts, manifests, relayer configuration, merchant controls,
evidence retention, and audits.
