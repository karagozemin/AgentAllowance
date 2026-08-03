# Hosted dynamic-rule settlement

This directory contains the sanitized, append-only evidence for the first hosted settlement using
a dynamically selected AgentAllowance rule. OpenZeppelin Relayer and the policy-aware facilitator
were running on Render; Stellar state was read independently from Testnet before and after.

The CLI authorization window was changed from 30 seconds (6 Testnet ledgers) to 60 seconds (12
Testnet ledgers). The prior 6-ledger attempt is recorded as an expiry failure; it did not settle or
change state. The successful attempt used rule `2` and the second delegated signer.

No authorization XDR, signatures, API keys, keystores, or secret keys are included here. The
original proof tree and earlier evidence directories remain unchanged.
