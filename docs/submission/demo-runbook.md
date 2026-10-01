# 90-Second Demo Runbook

The demo should show policy enforcement, not a generic wallet transfer. Use the pre-funded Testnet
deployment and keep the browser on the public console.

## Before recording

1. Open the deployed console and confirm the RPC indicator and treasury balance.
2. Confirm the latest active allowance has one delegated signer, one recipient, a visible cap, and a
   future ledger expiry.
3. Keep the successful transaction link and the evidence index open in separate tabs.
4. Do not display secrets, Render environment variables, or the operator fallback.

## Sequence

```text
00:00  AgentAllowance title, Testnet treasury, active allowance
00:12  Connect the treasury admin in Freighter and show the bounded rule fields
00:25  Run Approved payment: HTTP 402 -> verify -> settle -> protected response
00:45  Open the transaction hash and point to treasury decrease + merchant increase
00:58  Run Over-limit payment: policy block, no settlement, no balance change
01:08  Run Unapproved recipient: recipient policy block, no funds moved
01:18  Show evidence feed and facilitator policy event validation
01:27  State the reusable SDK example and strict facilitator extension
01:30  End on the architecture link and Testnet warning
```

## Spoken claim

> AgentAllowance gives an AI agent a bounded delegation, not an unrestricted wallet key. The agent
> pays an x402 service autonomously, while the OpenZeppelin smart account enforces the signer, token,
> recipient, spending window, and expiry on chain. Our facilitator extension accepts the approved
> OpenZeppelin policy event without weakening exact SEP-41 validation.

## Recording checklist

- Show one real transaction hash.
- Show one successful protected-resource response.
- Show two deterministic blocks and unchanged balances.
- State clearly that this is Stellar Testnet and unaudited software.
- Export the final video beside the release tag; do not commit private wallet material.
