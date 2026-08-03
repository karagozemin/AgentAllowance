# Architecture

AgentAllowance is split into five trust boundaries.

1. The OpenZeppelin smart-account treasury holds the SEP-41 asset. Its admin rule can add and
   remove context rules. Each allowance rule binds one delegated G-account, a token contract, a
   ledger expiry, the OpenZeppelin spending-limit policy, and the event-free recipient policy.
2. The SDK parses a strict x402 v2 challenge, performs local policy preflight, builds the SEP-41
   transfer, runs recording and enforcing simulation, and signs the two required Soroban
   authorization entries. Signer secrets stay in the server process or Stellar CLI keystore.
3. The policy-aware facilitator retains the canonical exact-transfer checks. For a dynamic rule it
   extracts the signed context rule ID, reads the pinned recipient-policy configuration on chain,
   checks the policy WASM hashes, and permits only the pinned `spending_limit_enforced` event.
4. The x402 demo service owns challenge idempotency and protected-resource unlock. SQLite claims a
   challenge atomically before settlement, so concurrent retries cannot submit twice.
5. The console calls only the server API. It displays treasury, allowance, decision, receipt and
   transaction evidence; it never receives private keys, facilitator API keys, or auth signatures.

The configured Relayer G-account is transaction source and fee payer. It cannot be the smart-account
payer, merchant, delegated signer, or any authorization-entry address.

The MVP uses the Testnet native XLM SAC because that is the asset used by the confirmed compatibility
proof. The original PRD's USDC target remains a deployment configuration change after issuer,
liquidity and decimal behavior are tested; multi-asset allowance rules are not implemented.
