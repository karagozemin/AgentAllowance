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
merchant resource. `agentallowance-console` is the authenticated operator UI and server-side signer
boundary. Both use SQLite under `/tmp`; that index is lost when a free instance is replaced or
redeployed, while contract rules, balances, and settlement transactions remain on Testnet. This is an
explicit demo limitation, not production persistence.

## Security boundary

- Never commit or paste the Stellar secret key, encrypted keystore, keystore passphrase, or API key.
- The Render service reads the encrypted keystore from `/etc/secrets/local-signer.json`.
- The configured Relayer G-account is only transaction source and fee payer. It must not be the
  smart-account payer, merchant, delegated signer, or an address-auth entry.
- The static config accepts only the pinned Testnet asset and manifest-pinned
  `spending_limit_enforced` event. Recipient-policy payment events remain unsupported.
- The console leaves only `/health` public. Every UI asset and `/api/*` route requires server-side
  HTTP Basic Auth over Render HTTPS; credentials are never bundled into React.
- The demo API has no admin signer. The console alone receives admin, transaction-source, and
  delegated-signer secrets.

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
| `TREASURY_CONTRACT` | `smartAccount` |
| `SPENDING_POLICY_CONTRACT` | `spendingPolicy` |
| `RECIPIENT_POLICY_CONTRACT` | `recipientPolicy` |
| `STELLAR_MERCHANT_ADDRESS` | `merchant` |
| `STELLAR_UNAPPROVED_RECIPIENT_ADDRESS` | `unapprovedRecipient` |

The console needs Testnet-only signer material. On macOS, copy each value directly to the clipboard
so it is not printed or added to shell history:

```bash
stellar --quiet keys secret agentallowance-admin | pbcopy
stellar --quiet keys secret agentallowance-fee-payer | pbcopy
stellar --quiet keys secret agentallowance-delegate-2 | pbcopy
openssl rand -base64 32 | pbcopy
```

Paste those results, one at a time, into `STELLAR_ADMIN_SECRET`, `STELLAR_FEE_PAYER_SECRET`,
`STELLAR_DELEGATE_SECRETS`, and `CONSOLE_AUTH_PASSWORD`. Use the delegate that will own newly created
allowances. Multiple delegate secrets may be comma-separated. Never put the OpenZeppelin Relayer
secret into these variables.

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

The console root and API must reject anonymous requests, then accept the configured operator:

```bash
curl --output /dev/null --write-out '%{http_code}\n' \
  https://agentallowance-console.onrender.com/
curl --fail --show-error --user 'operator:<CONSOLE_AUTH_PASSWORD>' \
  https://agentallowance-console.onrender.com/api/overview
```

The first command must print `401`. Open the console URL and enter the same credentials. With an empty
ephemeral database, create a fresh allowance before running a scenario. Confirm its delegated signer,
recipient, amount, rolling window, and expiry in the form. `Over limit` and `Unapproved recipient`
must be rejected without settlement. `Approved payment` performs a real Testnet `/verify` and
`/settle`; run it only when another 100000-stroop Testnet payment is intended.

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
