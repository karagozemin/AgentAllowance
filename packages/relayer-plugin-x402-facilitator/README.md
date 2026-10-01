# AgentAllowance policy-aware x402 facilitator

This package is a narrow workspace fork of OpenZeppelin's
`relayer-plugin-x402-facilitator` at commit
`100ccec1dcb597544a215f749796870e03c63c45` (`0.4.0`). The upstream source and
tests are retained. The configured smart-account path adds strict two-entry
delegated authorization and permits one manifest-pinned OpenZeppelin
`spending_limit_enforced` event alongside the one required SEP-41 transfer.

Recipient-policy events are intentionally unsupported. The recipient policy is
proved by its signed context rule, on-chain configuration, enforcing simulation,
and rejected payment to an unapproved recipient.

Unconfigured payers continue through the upstream event validator unchanged.
Trusted policy manifests are server-side Relayer plugin configuration and are
never accepted from an x402 payment payload.
