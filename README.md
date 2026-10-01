<p align="center">
  <img src="docs/assets/agentallowance-logo.jpg" alt="AgentAllowance" width="190" />
</p>

<h1 align="center">AgentAllowance</h1>

<p align="center"><strong>Policy-aware x402 infrastructure for autonomous AI spending on Stellar.</strong></p>

<p align="center">
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/security.md">Security model</a> ·
  <a href="docs/openzeppelin-facilitator-integration.md">Facilitator integration</a> ·
  <a href="docs/evidence/testnet/2026-08-03T20-19-52Z/">Testnet USDC evidence</a>
</p>

<p align="center">
  <img alt="Stellar Testnet" src="https://img.shields.io/badge/Stellar-Testnet-111111" />
  <img alt="x402 v2" src="https://img.shields.io/badge/x402-v2-1f8f75" />
  <img alt="OpenZeppelin Smart Accounts" src="https://img.shields.io/badge/OpenZeppelin-Smart_Accounts-4e5ee4" />
  <img alt="Status" src="https://img.shields.io/badge/status-live_testnet-20a878" />
</p>

AgentAllowance is a policy-aware x402 infrastructure layer for delegated AI spending on Stellar.
It resolves the demonstrated compatibility gap between OpenZeppelin Smart Accounts and strict Stellar
x402 facilitator validation while preserving exact SEP-41 transfer checks. The system combines a
smart-account treasury, delegated G-account signers, ledger expiry, an OpenZeppelin rolling spending
limit, an exact recipient policy, and a reusable policy-aware facilitator extension.

The existing compatibility proof remains unchanged under
`proofs/stellar-x402-smart-account/` and is used as the regression source of truth.

The repository application and contract code is MIT-licensed. The upstream-derived
`packages/relayer-plugin-x402-facilitator` keeps its AGPL-3.0-only license and OpenZeppelin
attribution; see that package's `LICENSE` file before redistributing it.

## Why AgentAllowance exists

Standard Stellar x402 payments expect one strict SEP-41 transfer event. OpenZeppelin Smart Account
policies can correctly authorize the same transfer while emitting an additional policy event. The
original hosted facilitator therefore rejected a payment that had already passed enforcing-mode
simulation, delegated authorization, and on-chain spending-policy checks.

AgentAllowance resolves that real integration gap without relaxing the verifier. It admits only the
manifest-pinned OpenZeppelin `spending_limit_enforced` event, validates every field against the signed
transfer, and continues rejecting unrelated events, unexpected authorization entries, altered
amounts or recipients, nested invocations, stale payloads, and unapproved WASM.

## What the demo proves

1. A parent C-account treasury can hold the payment asset.
2. A delegated agent can authorize an x402 payment without the owner signing every request.
3. Spending, recipient, token, and expiry restrictions are enforced by the smart account.
4. The policy-aware facilitator can verify and settle the exact transaction through an OpenZeppelin Relayer.
5. Over-limit and unapproved-recipient attempts fail without moving funds.
6. Every decision can be traced to simulation output, auth XDR, policy evidence, and a transaction hash.
7. Any Testnet Freighter wallet can create a distinct smart-account treasury and administer only its
   own allowances.

```text
Owner sets bounded permission -> Agent receives HTTP 402 -> Smart account enforces policy
-> Facilitator verifies exact transfer + approved policy event -> Relayer settles -> Resource unlocks
```

The full component, trust-boundary, authorization, and sequence diagrams are in
**[docs/architecture.md](docs/architecture.md)**.

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
- `packages/sdk`: deterministic owner-treasury deployment, multi-allowance administration, payer/fetch
  client, isolated SQLite evidence and reconciliation.
- `apps/x402-demo-api`: payer-agnostic HTTP 402 challenge, atomic settlement idempotency and protected resource.
- `apps/console`: public demo plus wallet-owned treasury onboarding and administration.

## Product modes

| Mode | Audience | Capability |
| --- | --- | --- |
| Public demo | Judges and visitors | Inspect evidence and trigger fixed approved/blocked scenarios with no arbitrary amount or recipient input |
| Wallet owner | Any Testnet Freighter user | Create a deterministic treasury, then create and revoke only that treasury's bounded allowances |
| Autonomous agent | Delegated backend signer | Complete x402 payments without per-payment owner approval |
| Operator fallback | Maintainers | Relayer maintenance, reconciliation, deployment, and emergency API access |

The primary UI does not expose a shared password. Freighter login uses a wallet-bound, one-time,
expiring challenge and a short-lived HttpOnly session. A first connection creates a deterministic
C-account whose constructor admin is that wallet. Create and revoke use a second Freighter prompt to
sign the exact Stellar authorization preimage; the backend validates owner, signer, network, nonce,
expiry and invocation, constructs the Soroban auth entry, and runs enforcing simulation before
fee-payer submission. Basic Auth remains an
emergency maintenance fallback and cannot authenticate an owner endpoint.

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
pnpm --filter @agentallowance/x402-sdk-example typecheck
```

The current suite passes 192 TypeScript unit/integration tests, 3 Rust contract tests, and 4
desktop/mobile Playwright runs: 199 automated checks in total.

The timed clean-environment prerequisite path is `scripts/quickstart-testnet.sh`. It prints the elapsed
time and leaves the merchant/API processes in separate terminals so a failed service cannot be hidden
inside a shell pipeline. The clean hosted-runner and local warm-cache measurements are recorded in
[docs/submission/quickstart-benchmark.md](docs/submission/quickstart-benchmark.md); the clean runner
completed the full CI verification in 71 seconds.

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

Load the runtime environment, set `CONSOLE_AUTH_USERNAME` and a long `CONSOLE_AUTH_PASSWORD` in
`.env.local`, then start the merchant API and console in separate terminals:

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
Expert links. The merchant API listens on `http://127.0.0.1:3001`. The public overview uses the bounded
demo treasury. Any Testnet Freighter wallet can sign a short-lived challenge, create its own
deterministic treasury, and then sign create/revoke authorization entries for that treasury only.
The delegated agent still pays autonomously after permission creation.

Dynamic facilitator profiles do not enumerate payer addresses or rule IDs. They pin the approved
smart-account WASM hash, recipient-policy contract/WASM and OpenZeppelin spending-policy contract/WASM,
then resolve the payer code identity and signed rule ID against on-chain policy configuration.

## Testnet sequence

Copy `.env.example` to `.env.local` and review every value. For the PRD's official Testnet USDC path,
first create the required trustlines and fund the fee payer from Circle's Testnet faucet:

```bash
pnpm --filter @agentallowance/testnet-cli run prepare-usdc
# Set STELLAR_TOKEN_CONTRACT to the reported SAC and wait until the reported balance is non-zero.
```

The deploy command creates and Friendbot-
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
`ATTEMPT_DIRECTORY` selects an exact payment attempt. Relative overrides are resolved from the
workspace root, including when pnpm executes the command from a package directory. Relayer secrets live only under the ignored
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
defined by `render.yaml`. It contains the facilitator, merchant demo API, and authenticated operator
console; follow [the Render guide](deploy/render/README.md) without committing any signer or API
secrets.

The hosted facilitator URL is deployment-specific. Always run `/verify` against the URL recorded in the
same evidence directory as the payment; do not infer current behavior from an older Render deploy.
The self-hosted fork remains the reproducible fallback and is the reference implementation for dynamic
context-rule IDs.

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

## Hosted dynamic-rule settlement

On 2026-08-03 the Render-hosted facilitator verified and settled rule `2` with the second delegated
signer. A previous 30-second authorization expired before hosted verification and was not settled;
the CLI now uses the same 60-second, 12-ledger bounded window as the demo API. The successful run
returned `isValid: true` before settlement and produced:

```text
Payment amount        100000 stroops (0.01 XLM)
Transaction           88c3e45841beb26665205ee15921c27bae886111e8a52feaed67bed951776b10
Ledger                3949257
Treasury balance      4700000 -> 4600000
Merchant balance      100000300000 -> 100000400000
Rule 2 spending state 100000 -> 200000
```

Sanitized evidence, including the rejected expiry attempt, hosted responses, and exact state deltas,
is under `docs/evidence/testnet/2026-08-03T14-09-36Z/`.

## Independent SDK integration

The second integration required by the PRD is [apps/x402-sdk-example](apps/x402-sdk-example/README.md).
It uses only `@agentallowance/sdk` and the merchant's HTTP 402 endpoint. This keeps the reusable SDK
contract separate from the console and testnet orchestration code.

## Official Testnet USDC result

On 2026-08-03 a fresh smart-account treasury was deployed against the official Stellar Testnet USDC
SAC. The same deployment produced two enforcing-mode policy rejections and one complete
`verify -> settle` payment through the local policy-aware OpenZeppelin Relayer.

```text
Asset                 USDC (7 decimals)
Token contract        CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
Payment amount        100000 atomic (0.0100000 USDC)
Transaction           11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3
Ledger                3953687
Treasury balance      5000000 -> 4900000
Merchant balance      0 -> 100000
Spending-limit state  0 -> 100000
Over-limit verify     rejected; settlement not attempted
Wrong-recipient verify rejected; settlement not attempted
```

The transaction is visible on
[Stellar Expert](https://stellar.expert/explorer/testnet/tx/11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3).
Sanitized, append-only deployment, rejection, verification, settlement, and state evidence is under
[docs/evidence/testnet/2026-08-03T20-19-52Z](docs/evidence/testnet/2026-08-03T20-19-52Z/).

The bounded public demo subsequently ran both policy blocks and a full paid-resource retry against
the same USDC treasury. It returned `PAID_AND_UNLOCKED` with transaction
[`ebfdc51dc534bb501b555a3b9541916361f2eb32573254992710acfca5125950`](https://stellar.expert/explorer/testnet/tx/ebfdc51dc534bb501b555a3b9541916361f2eb32573254992710acfca5125950).
The normalized product-flow evidence is under
[docs/evidence/testnet/2026-08-03T20-41-03Z](docs/evidence/testnet/2026-08-03T20-41-03Z/).

## Multi-wallet owner onboarding result

On 2026-08-03 an unconfigured, Friendbot-activated Testnet wallet authenticated through the same
wallet-bound console challenge and received its own deterministic smart-account treasury. Read-only
contract calls confirmed that rule `0` names that wallet as admin, while rule `1` contains the shared
delegated agent, official Testnet USDC, spending limit, recipient policy, and expiry. The wallet then
signed an exact admin authorization to create rule `2` and a second authorization to revoke it.

```text
Owner                  GBRAUS55PHX2NL5RRIMULZT2WIEBIYR2LLHIVZOHDPBWOWUJIE6S3UGA
Treasury               CBCXCPFP6EBWEYYQS7DWXFYQ3ZP24MNUFAIMFBI5ADTCXEWJTSBD27BU
Deploy transaction     c81c799af36f064ded0681ab52f8ff2f0c5e54a15f944b9c8a438bec26926faf
Funding transaction    6af28b90b3aa49ec98d57cd928a46c9dee0c8a438c7b9825ccbd47acfe546099
Create rule 2          6f07e5383589056c30b0c15fde90da28efb9f25f22a1f0c2aeb5040252fda032
Revoke rule 2          d46b076588821ac29e5cc7642d854ba4b2a0308bbc106f0ca7ed05cf62c85496
Treasury balance       100000 atomic USDC
```

The sanitized evidence is under
[docs/evidence/testnet/2026-08-03T21-41-46-267Z-multi-wallet-onboarding](docs/evidence/testnet/2026-08-03T21-41-46-267Z-multi-wallet-onboarding/).
The preceding fail-closed attempt with an unactivated G-account is retained separately under
[docs/evidence/testnet/2026-08-03T21-40-27Z-multi-wallet-onboarding-failed](docs/evidence/testnet/2026-08-03T21-40-27Z-multi-wallet-onboarding-failed/).

## Submission evidence

The reviewer-facing evidence index is [docs/submission/evidence-index.md](docs/submission/evidence-index.md).
It maps each product claim to a Testnet transaction, a denial record, a test command, or an explicit
known limitation. The short demo runbook is [docs/submission/demo-runbook.md](docs/submission/demo-runbook.md),
and the remaining release gates are tracked in [docs/submission/checklist.md](docs/submission/checklist.md).

## Scope and limitations

The MVP is now proven with the official Testnet USDC SAC. The earlier native XLM proof and hosted
settlements remain historical compatibility evidence. Multi-asset rules, MPP,
`recipient_policy_enforced`, threshold administration, npm publication and production custody are
excluded. See the
[architecture](docs/architecture.md) and [security model](docs/security.md).
