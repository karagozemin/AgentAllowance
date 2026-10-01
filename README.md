# AgentAllowance

AgentAllowance is a policy-aware x402 infrastructure layer for delegated AI spending on Stellar.
It resolves the demonstrated compatibility gap between OpenZeppelin Smart Accounts and strict Stellar
x402 facilitator validation while preserving exact SEP-41 transfer checks. The system combines a
smart-account treasury, delegated G-account signers, ledger expiry, an OpenZeppelin rolling spending
limit, an exact recipient policy, and a reusable policy-aware facilitator extension.

The existing compatibility proof remains unchanged under
`proofs/stellar-x402-smart-account/` and is used as the regression source of truth.

## Implemented core

- `contracts/treasury-account`: OpenZeppelin smart account with admin rule `0` and initial allowance
  rule `1`.
- `contracts/spending-limit-policy`: thin wrapper over OpenZeppelin's first-party implementation.
- `contracts/recipient-policy`: fail-closed SEP-41 transfer destination policy. It emits no payment-time
  contract event, minimizing the facilitator allowlist surface.
- `packages/stellar-smart-account-auth`: builds and validates the two-entry delegated authorization.
- `packages/facilitator-policy`: validates the exact transfer, two-entry auth structure, approved
  `spending_limit_enforced` event, and pinned policy WASM identity.
- `packages/relayer-plugin-x402-facilitator`: pinned OpenZeppelin fork with the policy-aware branch.
- `apps/testnet-cli`: separate deploy, relayer preparation, scenario authorization, verify, settle, and status commands.
- `packages/shared`: strict x402 v2 types, reason codes, amount conversion, hashing and receipts.
- `packages/x402-payer`: smart-account transfer construction, enforcing simulation and facilitator client.
- `packages/sdk`: multi-allowance administration, payer/fetch client, SQLite evidence and reconciliation.
- `apps/x402-demo-api`: real HTTP 402 challenge, atomic settlement idempotency and protected resource.
- `apps/console`: server-only signer boundary plus responsive React treasury and command console.

## Pinned versions

```text
OpenZeppelin stellar-accounts  0.7.2
Soroban SDK                    26.1.0
Stellar JavaScript SDK         16.2.0
OpenZeppelin facilitator base  100ccec1dcb597544a215f749796870e03c63c45
```

`Cargo.lock` also pins `ed25519-dalek` to `2.2.0`; the upstream Soroban host currently declares
`>=2.0.0`, which otherwise resolves to incompatible `3.0.0`.

## Local verification

Prerequisites: Node.js 22.18+, pnpm 10+, Rust 1.84+, `wasm32v1-none`, and Stellar CLI 27+.

```bash
pnpm install
pnpm typecheck
pnpm test
cargo test --workspace
stellar contract build
pnpm --filter @agentallowance/console test:e2e
```

The TypeScript tests consume the proof's real transaction and simulation XDR. They confirm that the
policy-aware validator accepts the proven payment while rejecting an unapproved contract, unrelated
event, duplicate policy event, duplicate transfer, unsuccessful-call event, code-hash mismatch, and a
third authorization entry.

## Run the complete local product

Prepare and start the local OpenZeppelin Relayer. Generated API keys, keystores and passphrases stay
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

Open `http://127.0.0.1:3000`. The console creates and revokes real Testnet rules, runs approved,
over-limit and unapproved-recipient x402 scenarios, and correlates decisions with receipts and Stellar
Expert links. The merchant API listens on `http://127.0.0.1:3001`.

Dynamic facilitator profiles do not enumerate rule IDs. They pin the smart account,
recipient-policy contract/WASM and OpenZeppelin spending-policy contract/WASM, then resolve the signed
rule ID against on-chain policy configuration.

## Testnet sequence

Copy `.env.example` to `.env.local` and review every value. The deploy command creates and Friendbot-
funds missing Stellar CLI identities, deploys three contracts, and funds the smart account. It changes
Testnet state.

```bash
pnpm --filter @agentallowance/testnet-cli run deploy
STATE_LABEL=before pnpm --filter @agentallowance/testnet-cli run status
pnpm run relayer:prepare
pnpm run relayer:start
SCENARIO=successful-payment pnpm --filter @agentallowance/testnet-cli run authorize
pnpm --filter @agentallowance/testnet-cli run verify
```

Review `artifacts/testnet/latest.json`, the referenced `verify-response.json`, transaction XDR,
simulation logs, authorization entries, and manifest before settlement.

Settlement is blocked unless verification succeeded and the operator explicitly enables it:

```bash
ALLOW_SETTLEMENT=yes pnpm --filter @agentallowance/testnet-cli run settle
STATE_LABEL=after pnpm --filter @agentallowance/testnet-cli run status
pnpm --filter @agentallowance/testnet-cli run archive-settlement
```

Each `authorize` command creates a new timestamped directory under `attempts/`; it never reuses a
transaction XDR or overwrites earlier scenario evidence. `RUN_DIRECTORY` selects a deployment and
`ATTEMPT_DIRECTORY` selects an exact payment attempt. Relayer secrets live only under the ignored
`artifacts/local/` runtime tree and are never copied into Testnet evidence.

## Confirmed Testnet settlement

The first policy-aware settlement completed on 2026-08-01. The facilitator accepted the smart
C-account payer and the two delegated authorization entries, then the configured Relayer submitted
the SEP-41 transfer as source and fee payer.

```text
Payment amount       100000 stroops (0.01 XLM)
Transaction          211b39fe4859ecfa754de8d597286c4b697be33bdae05c6fadd5bfb7ec90658c
Ledger               3916054
Treasury balance     5000000 -> 4900000
Merchant balance     100000000000 -> 100000100000
Spending-limit state 0 -> 100000
```

The successful attempt is under
`artifacts/testnet/runs/2026-08-01T15-10-40-519Z/attempts/2026-08-01T15-56-13-904Z-successful-payment/`.
The transaction RPC response, facilitator logs, verify/settle responses, simulations, auth entries,
and transaction XDR are retained there. The hosted OpenZeppelin facilitator was not modified.

## Confirmed Render Testnet settlement

The Render-hosted policy-aware deployment completed a second independent settlement on 2026-08-01.
It first returned `isValid: true` for a fresh ledger-bounded authorization, then settled the exact
same 100000-stroop payment through the configured OpenZeppelin Relayer.

```text
Facilitator           https://agentallowance-facilitator.onrender.com/api/v1/plugins/x402-facilitator/call
Payment amount        100000 stroops (0.01 XLM)
Transaction           400a97d03eb6a866088d5ccb95660f1b52454ae661b6c88b87e2f31061c571a9
Ledger                3918507
Treasury balance      4900000 -> 4800000
Merchant balance      100000100000 -> 100000200000
Spending-limit state  100000 -> 200000
```

The append-only live evidence is under
`artifacts/testnet/runs/2026-08-01T15-10-40-519Z/attempts/2026-08-01T19-21-09-897Z-successful-payment/`.
The matching before/after state snapshots are named `state-render-before-approved-*` and
`state-render-after-approved-*` in the deployment run directory.

## Facilitator deployment

OpenZeppelin's unmodified hosted facilitator still rejects the valid policy event. The local fork uses
the official `openzeppelin/openzeppelin-relayer:1.7.0` image and the deployment steps in
[the integration guide](docs/openzeppelin-facilitator-integration.md). A Render Free Testnet demo is
defined by `render.yaml`; follow [the Render guide](deploy/render/README.md) without committing any
signer or API secrets.

The currently running Render service was last confirmed with the original rule `1`-pinned manifest.
On 2026-08-03 it rejected newly created rule `2` with
`invalid_exact_stellar_payload_auth_structure`. Redeploy the current dynamic manifest build before
using that hosted URL for new allowances. Hosted infrastructure is not assumed mutable.

## Dynamic allowance Testnet result

On 2026-08-03 the SDK created rule `2` for a second delegated signer. Independent reads confirmed the
exact token, merchant, `500000`-stroop limit, 720-ledger period and expiry. Over-limit and
unapproved-recipient scenarios were blocked without changing balances or policy state. The local
policy-aware OpenZeppelin Relayer then completed the full
`402 -> verify -> settle -> paid retry -> protected resource` flow:

```text
Payment amount        100000 stroops (0.01 XLM)
Transaction           db9547660e7adb57f371fcbacacb635c0714e4f205024cdf1192bb00034afa1c
Ledger                3948647
Treasury balance      4800000 -> 4700000
Merchant balance      100000200000 -> 100000300000
Rule 2 spending state 0 -> 100000
Resource result       PAID_AND_UNLOCKED
```

Sanitized append-only evidence is under `docs/evidence/testnet/2026-08-03T13-18-26Z/`. Earlier proof
and Testnet artifact trees remain unchanged.

## Scope and limitations

The MVP uses the Testnet native XLM SAC from the source proof. The PRD's USDC target needs a separate
asset configuration test; multi-asset rules are not included. MPP, `recipient_policy_enforced`,
threshold administration, npm publication and production custody are excluded. See the
[architecture](docs/architecture.md) and [security model](docs/security.md).
