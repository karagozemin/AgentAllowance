# Official Testnet USDC evidence

This append-only directory records the first complete AgentAllowance settlement using the official
Stellar Testnet USDC asset. It contains public addresses, normalized facilitator decisions, policy
state, and the confirmed transaction hash. Secrets, authorization signatures, transaction XDR, API
keys, and keystores are intentionally excluded.

The local OpenZeppelin Relayer `1.7.0` ran the policy-aware facilitator extension. The successful
payment used a smart C-account payer and a delegated G-account signer. The same deployment also
rejected an over-limit payment and an unapproved recipient during enforcing simulation.

- `deployment.json`: public contracts, account addresses, rule configuration, and pinned WASM hashes.
- `blocked-attempts.json`: normalized facilitator responses for both denied scenarios.
- `settlement.json`: successful `/verify`, `/settle`, RPC confirmation, and exact state deltas.

Transaction:

`11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3`

Stellar Expert:

<https://stellar.expert/explorer/testnet/tx/11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3>
