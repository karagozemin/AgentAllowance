# Dynamic allowance Testnet evidence

This directory is a sanitized, append-only export of the first complete payment made by a
dynamically created AgentAllowance rule. It contains public Testnet addresses, transaction hashes,
policy state, and normalized responses only. Authorization signatures, transaction XDR, API keys,
keystores, and secret keys are intentionally excluded.

The run used OpenZeppelin Relayer `1.7.0` locally with the policy-aware facilitator plugin. The
Render deployment was tested separately and rejected rule `2` because it was still running the
previous rule `1`-pinned build.

Files:

- `allowance.json`: rule creation transaction and independently read on-chain configuration.
- `blocked-attempts.json`: over-budget and unapproved-recipient decisions with unchanged state.
- `settlement.json`: normalized x402 receipt and exact before/after values.
- `hosted-facilitator.json`: the explicit hosted-deployment limitation observed during this run.
