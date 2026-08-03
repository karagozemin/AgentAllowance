# Render Free deployment

This deployment is for the Testnet demo only. It runs the policy-aware facilitator on the official
OpenZeppelin Relayer `1.7.0` image and uses one Render Free Key Value instance. Free web services
sleep after inactivity, have an ephemeral filesystem, and can take about a minute to wake up.
The Blueprint disables OpenZeppelin's persistent Node.js plugin worker pool because its startup heap
budget exceeds the free instance's 512 MB memory; the Relayer uses its supported legacy ts-node
execution path instead. This changes execution capacity, not facilitator validation.
OpenZeppelin Relayer `1.7.0`'s legacy ts-node plugin socket does not reliably service nested RPC calls
under Render Free CPU throttling. The container therefore runs a minimal public adapter that loads
the same bundled policy-aware handler once and calls the local first-party Relayer HTTP API for
relayer info, read-only Stellar RPC, and transaction submission. The Relayer remains the signer,
transaction source, fee payer, and settlement engine. The adapter preserves the existing endpoint
and bearer API key, and does not replace or relax verifier logic.

The Blueprint also defines two Node services. `agentallowance-demo-api` is the public x402-protected
merchant resource and accepts any smart-account payer approved by the policy-aware facilitator.
`agentallowance-console` provides a bounded public demo plus per-wallet Testnet treasury onboarding.
Both use SQLite under `/tmp`; payment-attempt history is lost when a free instance is replaced, while
deterministic owner treasury discovery, on-chain allowance reconstruction, balances, policy state, and
settlement transactions remain available from Testnet.

## Security boundary

- Never commit or paste the Stellar secret key, encrypted keystore, keystore passphrase, or API key.
- The Render service reads the encrypted keystore from `/etc/secrets/local-signer.json`.
- The configured Relayer G-account is only transaction source and fee payer. It must not be the
  smart-account payer, merchant, delegated signer, or an address-auth entry.
- The static config accepts only the pinned Testnet asset and manifest-pinned
  `spending_limit_enforced` event. Recipient-policy payment events remain unsupported.
- The console exposes its UI, `/operator`, `/health`, and `/api/overview` publicly. Any Testnet
  Freighter G-account may sign a wallet-bound challenge and receive a short-lived HttpOnly session for
  its own deterministic treasury. Basic Auth remains an emergency maintenance fallback and cannot
  authenticate owner endpoints; credentials are never bundled into React.
- The demo API has no admin signer. The console receives the public admin address plus fee-payer and
  delegated-signer secrets; the admin private key stays in Freighter.

## 1. Locate the local secrets

Prepare the local runtime once if `artifacts/local/relayer/latest.env` does not exist:

```bash
pnpm run relayer:prepare
```

Get the current runtime directory without printing any secret:

```bash
jq -r .runtimeDirectory artifacts/local/relayer/latest.json
```

Upload `<runtimeDirectory>/config/keys/local-signer.json` as the Render secret file named
`local-signer.json`. Its mount path must be exactly `/etc/secrets/local-signer.json`.

Read the matching passphrase locally and enter it directly into Render's secret env field:

```bash
sed -n 's/^RELAYER_KEYSTORE_PASSPHRASE=//p' artifacts/local/relayer/latest.env
```

Do not send either value in chat or put it in a shell history argument.

## 2. Collect hosted app values

Print only the public deployment values:

```bash
run_dir=$(jq -r .runDirectory artifacts/testnet/latest.json)
jq '{token,smartAccount,spendingPolicy,recipientPolicy,merchant,unapprovedRecipient}' \
  "$run_dir/deployment.json"
```

| Render variable | Deployment field |
| --- | --- |
| `STELLAR_TOKEN_CONTRACT` | `token` |
| `STELLAR_ASSET_CODE` | `assetCode` (`USDC` for the PRD deployment) |
| `TREASURY_CONTRACT` | `smartAccount` |
| `TREASURY_WASM_HASH` | `wasmHashes.treasury` |
| `SPENDING_POLICY_CONTRACT` | `spendingPolicy` |
| `RECIPIENT_POLICY_CONTRACT` | `recipientPolicy` |
| `STELLAR_MERCHANT_ADDRESS` | `merchant` |
| `STELLAR_UNAPPROVED_RECIPIENT_ADDRESS` | `unapprovedRecipient` |
| `INITIAL_DELEGATED_SIGNER` | `delegate` |
| `INITIAL_ALLOWANCE_RULE_ID` | `allowanceRuleId` |
| `INITIAL_ALLOWANCE_VALID_UNTIL_LEDGER` | `validUntil` |
| `SPENDING_LIMIT` | `spendingLimit` |
| `PERIOD_LEDGERS` | `periodLedgers` |
| `PUBLIC_DEMO_ALLOWANCE_ID` | `allowanceRuleId` |

The console needs Testnet-only fee-sponsor and delegated-signer material. The public demo admin private
key stays outside the primary flow; set `STELLAR_ADMIN_ADDRESS` to the deployment's `admin` field.
Every newly connected wallet becomes admin of its own deterministic treasury. On macOS, copy each
remaining secret directly to the clipboard
so it is not printed or added to shell history:

```bash
stellar --quiet keys secret agentallowance-fee-payer | pbcopy
stellar --quiet keys secret agentallowance-delegate-2 | pbcopy
openssl rand -base64 32 | pbcopy
```

Paste those results, one at a time, into `STELLAR_FEE_PAYER_SECRET`,
`STELLAR_DELEGATE_SECRETS`, and `CONSOLE_AUTH_PASSWORD`. Use the delegate that will own newly created
allowances. Multiple delegate secrets may be comma-separated. Never put the OpenZeppelin Relayer
secret into these variables. `STELLAR_ADMIN_SECRET` is an optional emergency Testnet fallback and
should be omitted from the primary wallet-owner deployment.

`OWNER_INITIAL_FUNDING_ATOMIC` controls the one-time Testnet onboarding faucet. The Blueprint uses
`100000` atomic USDC so a newly created treasury can demonstrate one small payment. Set it to `0` to
disable sponsored funding. `OWNER_TREASURY_VERSION` must change only when deliberately moving owners
to a new deterministic deployment profile.

## 3. Create or update the Blueprint

1. Push `render.yaml`, `deploy/render/`, and `deploy/apps/` to the GitHub branch Render will deploy.
2. In Render, select **New > Blueprint** and connect the repository. If it already exists, open it and
   select **Sync Blueprint**.
3. Enter every field marked `sync: false`. Render generates the facilitator `API_KEY`, shares it with
   both Node services, and connects `REDIS_URL` without exposing either value to the browser.
   The demo API requires `STELLAR_TOKEN_CONTRACT`, `TREASURY_CONTRACT`,
   `STELLAR_MERCHANT_ADDRESS`, and `STELLAR_UNAPPROVED_RECIPIENT_ADDRESS`; the console additionally
   requires its two policy contract addresses and signer/auth secrets. Do not leave these blank.
4. Create or sync the Blueprint. The facilitator can fail until its secret file is installed.
5. Open `agentallowance-facilitator > Environment > Secret Files`.
6. Add a secret file named `local-signer.json` by uploading the encrypted local keystore.
7. Because `autoDeployTrigger` is off, trigger **Manual Deploy > Deploy latest commit** for the
   facilitator, demo API, and console, in that order.

The service URL has this facilitator endpoint:

```text
https://<render-service>.onrender.com/api/v1/plugins/x402-facilitator/call
```

## 4. Verify the facilitator

Wait for the service to report `Live`, then check the unauthenticated health endpoint:

```bash
curl --fail --show-error https://<render-service>.onrender.com/api/v1/health
```

Copy the generated `API_KEY` from Render's Environment page into `.env.local` together with the
public facilitator URL:

```dotenv
X402_FACILITATOR_URL=https://<render-service>.onrender.com/api/v1/plugins/x402-facilitator/call
X402_FACILITATOR_API_KEY=<Render API_KEY>
```

Run a fresh authorization before every verification. Payment XDR and authorization signatures are
single-use and ledger-bounded:

```bash
SCENARIO=over-limit pnpm --filter @agentallowance/testnet-cli run authorize
pnpm --filter @agentallowance/testnet-cli run verify

SCENARIO=unapproved-recipient pnpm --filter @agentallowance/testnet-cli run authorize
pnpm --filter @agentallowance/testnet-cli run verify

SCENARIO=successful-payment pnpm --filter @agentallowance/testnet-cli run authorize
pnpm --filter @agentallowance/testnet-cli run verify
```

To verify a dynamically created allowance without changing the historical deployment record, select
its rule and local delegate identity explicitly:

```bash
SCENARIO=successful-payment \
ALLOWANCE_RULE_ID_OVERRIDE=2 \
STELLAR_DELEGATE_IDENTITY_OVERRIDE=agentallowance-delegate-2 \
pnpm --filter @agentallowance/testnet-cli run authorize
pnpm --filter @agentallowance/testnet-cli run verify
```

Do not call `settle` during deployment verification. A further settlement requires an explicit
review of the exact amount, token, payer, merchant, facilitator URL, and successful verify response.

## 5. Verify the demo API and console

Both public health routes must return `200` without credentials:

```bash
curl --fail --show-error https://agentallowance-demo-api.onrender.com/health
curl --fail --show-error https://agentallowance-console.onrender.com/health
```

The dashboard and overview must be public. Operator mode must reject anonymous requests, then accept
the configured operator:

```bash
curl --output /dev/null --write-out '%{http_code}\n' \
  https://agentallowance-console.onrender.com/
curl --fail --show-error \
  https://agentallowance-console.onrender.com/api/overview
curl --output /dev/null --write-out '%{http_code}\n' \
  https://agentallowance-console.onrender.com/operator
curl --fail --show-error --user 'operator:<CONSOLE_AUTH_PASSWORD>' \
  https://agentallowance-console.onrender.com/operator
```

The public root, overview, and anonymous `/operator` must return `200`. Open the console URL, select
**Connect Freighter**, connect any funded Testnet wallet, and sign the challenge. Select **Create my
treasury**; confirm that the returned C-account differs for a second wallet. The constructor installs
the connected wallet as admin and the configured delegate as the initial autonomous agent. Create and
revoke additional rules through Freighter, then confirm the exact signer, recipient, amount, rolling
window, and expiry. `Over limit` and `Unapproved recipient` must be rejected without settlement.
`Approved payment` performs a real Testnet `/verify` and `/settle`; run it only when another 100000
atomic-unit Testnet payment is intended.

## Local container check

With Docker running, build the exact image used by both Node services:

```bash
docker build -f deploy/apps/Dockerfile -t agentallowance-apps:test .
```

The normal non-container checks are:

```bash
pnpm --filter @agentallowance/console test
pnpm --filter @agentallowance/x402-demo-api test
pnpm --filter @agentallowance/console build
pnpm --filter @agentallowance/x402-demo-api build
```

## Rollback and cleanup

1. Suspend `agentallowance-console` first, then `agentallowance-demo-api`. The facilitator can remain
   available for CLI verification or be suspended separately.
2. Remove the console signer secrets and rotate `CONSOLE_AUTH_PASSWORD` before redeploying.
3. Rotate or delete the facilitator `API_KEY` and `KEYSTORE_PASSPHRASE` when removing it.
4. Delete the Render secret file when removing the facilitator.
5. If the encrypted keystore or passphrase was exposed, rotate the Testnet Relayer identity and
   redeploy. An encrypted keystore is not a backup of the Stellar secret key.

Render Free has no durable service guarantee. Keep the local Docker deployment as the deterministic
fallback for judging and demos.

## Confirmed live result

The deployed adapter completed a policy-aware Testnet verification and settlement on 2026-08-01.
The verification returned `isValid: true`; settlement succeeded in ledger `3918507` with transaction
`400a97d03eb6a866088d5ccb95660f1b52454ae661b6c88b87e2f31061c571a9`. Treasury, merchant, and
spending-limit state each changed by exactly 100000 stroops. The archived attempt is:

```text
artifacts/testnet/runs/2026-08-01T15-10-40-519Z/attempts/2026-08-01T19-21-09-897Z-successful-payment/
```
