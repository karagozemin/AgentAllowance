# Testnet Settlement History

This page preserves the chronological compatibility and settlement record outside the reviewer-first
root README. The [submission evidence index](../submission/evidence-index.md) is the shortest path from
each product claim to its durable artifact.

## Official Testnet USDC settlement

On 2026-08-03 a fresh smart-account treasury was deployed against the official Stellar Testnet USDC
SAC. The same deployment produced two enforcing-mode policy rejections and one complete
`verify -> settle` payment through the local policy-aware OpenZeppelin Relayer.

```text
Asset                  USDC (7 decimals)
Token contract         CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
Payment amount         100000 atomic (0.0100000 USDC)
Transaction            11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3
Ledger                 3953687
Treasury balance       5000000 -> 4900000
Merchant balance       0 -> 100000
Spending-limit state   0 -> 100000
Over-limit verify      rejected; settlement not attempted
Wrong-recipient verify rejected; settlement not attempted
```

[Stellar Expert transaction](https://stellar.expert/explorer/testnet/tx/11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3) ·
[append-only evidence](testnet/2026-08-03T20-19-52Z/)

The bounded public demo later ran both policy blocks and a full paid-resource retry against the same
USDC treasury. It returned `PAID_AND_UNLOCKED` with transaction
[`ebfdc51dc534bb501b555a3b9541916361f2eb32573254992710acfca5125950`](https://stellar.expert/explorer/testnet/tx/ebfdc51dc534bb501b555a3b9541916361f2eb32573254992710acfca5125950).
The normalized product-flow evidence is under [2026-08-03T20-41-03Z](testnet/2026-08-03T20-41-03Z/).

## Wallet-owner onboarding and hosted USDC settlement

An unconfigured, Friendbot-activated Testnet wallet authenticated through the wallet-bound console
challenge and received its own deterministic smart-account treasury. Contract reads confirmed rule
`0` named that wallet as admin. The wallet then signed exact admin authorizations to create and revoke
rule `2`.

```text
Owner               GBRAUS55PHX2NL5RRIMULZT2WIEBIYR2LLHIVZOHDPBWOWUJIE6S3UGA
Treasury            CBCXCPFP6EBWEYYQS7DWXFYQ3ZP24MNUFAIMFBI5ADTCXEWJTSBD27BU
Deploy transaction  c81c799af36f064ded0681ab52f8ff2f0c5e54a15f944b9c8a438bec26926faf
Funding transaction 6af28b90b3aa49ec98d57cd928a46c9dee0c8a438c7b9825ccbd47acfe546099
Create rule 2       6f07e5383589056c30b0c15fde90da28efb9f25f22a1f0c2aeb5040252fda032
Revoke rule 2       d46b076588821ac29e5cc7642d854ba4b2a0308bbc106f0ca7ed05cf62c85496
```

The wallet-owned treasury then completed the hosted public flow. The approved request unlocked the
resource, while over-limit and unapproved-recipient requests were rejected without another transfer.

```text
Payment amount         100000 atomic (0.0100000 USDC)
Transaction            449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d
Ledger                 3956162
Treasury balance       100000 -> 0
Merchant balance       200000 -> 300000
Rule 2 spending state  0 -> 100000
Resource result        PAID_AND_UNLOCKED
Over-limit result      BUDGET_EXCEEDED
Wrong-recipient result RECIPIENT_NOT_ALLOWED
```

[Stellar Expert transaction](https://stellar.expert/explorer/testnet/tx/449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d) ·
[settlement evidence](testnet/2026-08-03T23-49-21Z-hosted-wallet-settlement/) ·
[onboarding evidence](testnet/2026-08-03T21-41-46-267Z-multi-wallet-onboarding/)

The preceding fail-closed attempt with an unactivated G-account is retained under
[2026-08-03T21-40-27Z](testnet/2026-08-03T21-40-27Z-multi-wallet-onboarding-failed/).

## Dynamic allowance settlements

On 2026-08-03 the SDK created rule `2` for a second delegated signer. Independent reads confirmed the
token, merchant, `500000`-stroop limit, 720-ledger period, and expiry. Over-limit and wrong-recipient
attempts were blocked without changing balances or policy state. The local facilitator then completed
the full `402 -> verify -> settle -> paid retry -> protected resource` flow.

```text
Payment amount        100000 stroops (0.01 XLM)
Transaction           db9547660e7adb57f371fcbacacb635c0714e4f205024cdf1192bb00034afa1c
Ledger                3948647
Treasury balance      4800000 -> 4700000
Merchant balance      100000200000 -> 100000300000
Rule 2 spending state 0 -> 100000
Resource result       PAID_AND_UNLOCKED
```

Evidence: [2026-08-03T13-18-26Z](testnet/2026-08-03T13-18-26Z/).

The Render-hosted facilitator later verified and settled the same dynamic rule with the second
delegate. A previous 30-second authorization expired before verification and was not settled.

```text
Payment amount        100000 stroops (0.01 XLM)
Transaction           88c3e45841beb26665205ee15921c27bae886111e8a52feaed67bed951776b10
Ledger                3949257
Treasury balance      4700000 -> 4600000
Merchant balance      100000300000 -> 100000400000
Rule 2 spending state 100000 -> 200000
```

Evidence, including the rejected expiry attempt: [2026-08-03T14-09-36Z](testnet/2026-08-03T14-09-36Z/).

## Initial XLM compatibility settlements

The first policy-aware settlement completed on 2026-08-01. The facilitator accepted the smart
C-account payer and two delegated authorization entries, then the configured Relayer submitted the
SEP-41 transfer as source and fee payer.

```text
Payment amount       100000 stroops (0.01 XLM)
Transaction          211b39fe4859ecfa754de8d597286c4b697be33bdae05c6fadd5bfb7ec90658c
Ledger               3916054
Treasury balance     5000000 -> 4900000
Merchant balance     100000000000 -> 100000100000
Spending-limit state 0 -> 100000
```

The corresponding append-only artifact directory is
`artifacts/testnet/runs/2026-08-01T15-10-40-519Z/attempts/2026-08-01T15-56-13-904Z-successful-payment/`.

The Render-hosted policy-aware deployment completed a second independent XLM settlement later that
day.

```text
Payment amount       100000 stroops (0.01 XLM)
Transaction          400a97d03eb6a866088d5ccb95660f1b52454ae661b6c88b87e2f31061c571a9
Ledger               3918507
Treasury balance     4900000 -> 4800000
Merchant balance     100000100000 -> 100000200000
Spending-limit state 100000 -> 200000
```

Its artifact directory is
`artifacts/testnet/runs/2026-08-01T15-10-40-519Z/attempts/2026-08-01T19-21-09-897Z-successful-payment/`.

These XLM records are historical compatibility evidence. The official submission path and current
product claim use Stellar Testnet USDC.
