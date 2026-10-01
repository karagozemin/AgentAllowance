# Hosted wallet-owner USDC settlement

This append-only evidence records the first successful public-console settlement from a treasury
created through the wallet-owner flow. The hosted policy-aware facilitator settled one delegated
payment, after which the same allowance rejected an over-limit payment and an unapproved recipient.

- Network: `stellar:testnet`
- Asset: official Testnet USDC SAC
- Payment: `0.01 USDC` (`100000` atomic units)
- Allowance: rule `2`
- Transaction: `449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d`
- Ledger: `3956162`
- Stellar Expert: <https://stellar.expert/explorer/testnet/tx/449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d>

Independent post-settlement reads confirmed the treasury balance moved from `100000` to `0`, the
merchant balance moved from `200000` to `300000`, and rolling spend moved from `0` to `100000`.
The recipient-policy configuration remained pinned to the exact USDC token and merchant.

- `public-demo.json` contains the normalized facilitator receipt, all three decisions, and state deltas.
- `transaction-result.json` contains independently fetched transaction, authorization, and event facts.
- `transaction-envelope.xdr` contains the exact submitted transaction envelope returned by Stellar RPC.

No private keys, API keys, browser sessions, or operator credentials are included.
