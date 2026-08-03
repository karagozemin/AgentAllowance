# AgentAllowance SDK example

This is the independent integration promised by the PRD. It is a small TypeScript process that uses
the public `@agentallowance/sdk` API against the real x402 demo service. It does not import console
internals, the testnet CLI, or facilitator implementation code.

## Run

From the repository root:

```bash
pnpm install
cp apps/x402-sdk-example/.env.example apps/x402-sdk-example/.env
# Fill the values from artifacts/testnet/latest.json and artifacts/local/relayer/latest.env.
pnpm --filter @agentallowance/x402-sdk-example typecheck
pnpm --filter @agentallowance/x402-sdk-example start
```

Required values are:

```text
PAID_URL=http://127.0.0.1:3001/premium
ALLOWANCE_ID=1
STELLAR_TOKEN_CONTRACT=C...
TREASURY_CONTRACT=C...
SPENDING_POLICY_CONTRACT=C...
RECIPIENT_POLICY_CONTRACT=C...
X402_FACILITATOR_URL=http://127.0.0.1:8080/api/v1/plugins/x402-facilitator/call
ADMIN_ADDRESS=G...
DELEGATED_SIGNER_SECRET=S...
FEE_PAYER_SECRET=S...
```

The process performs the real `402 -> payment authorization -> facilitator verify -> settle -> retry`
flow. It prints the protected response only after the receipt matches the original challenge. Secrets
are read by the process and are never sent to the browser or committed.
