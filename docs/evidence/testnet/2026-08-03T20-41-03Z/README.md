# Public demo USDC evidence

This append-only export records the bounded public demo against the official Testnet USDC
deployment. The same console and merchant API path produced two policy blocks followed by one real
`HTTP 402 -> verify -> settle -> paid retry -> protected resource` result.

No signer secrets, browser sessions, authorization signatures, API keys, or transaction XDR are
included.

- `public-demo.json`: all three decisions, the protected response, receipt, and exact state deltas.
- Transaction: `ebfdc51dc534bb501b555a3b9541916361f2eb32573254992710acfca5125950`
- Stellar Expert: <https://stellar.expert/explorer/testnet/tx/ebfdc51dc534bb501b555a3b9541916361f2eb32573254992710acfca5125950>
