# Render Free deployment

This deployment is for the Testnet demo only. It runs the policy-aware facilitator on the official
OpenZeppelin Relayer `1.7.0` image and uses one Render Free Key Value instance. Free web services
sleep after inactivity, have an ephemeral filesystem, and can take about a minute to wake up.
The Blueprint disables OpenZeppelin's persistent Node.js plugin worker pool because its startup heap
budget exceeds the free instance's 512 MB memory; the Relayer uses its supported legacy ts-node
execution path instead. This changes execution capacity, not facilitator validation.
The first plugin call after a cold start can take tens of seconds. OpenZeppelin Relayer `1.7.0`
hard-codes a 30-second plugin-to-relayer socket timeout, which is too short when Render throttles the
free instance during ts-node startup. The Dockerfile applies an exact-match, version-pinned patch to
raise only that internal timeout to 90 seconds. The Testnet demo uses a 150-second plugin timeout and
a 170-second HTTP timeout. This increases authenticated request occupancy and is not a production
sizing recommendation.

The service uses two Actix workers even though the free instance exposes one vCPU. One worker can be
occupied by the outer plugin HTTP request while the second services the plugin-to-relayer transport.
This trades throughput for correctness under the legacy ts-node execution mode.

## Security boundary

- Never commit or paste the Stellar secret key, encrypted keystore, keystore passphrase, or API key.
- The Render service reads the encrypted keystore from `/etc/secrets/local-signer.json`.
- The configured Relayer G-account is only transaction source and fee payer. It must not be the
  smart-account payer, merchant, delegated signer, or an address-auth entry.
- The static config accepts only the pinned Testnet asset and manifest-pinned
  `spending_limit_enforced` event. Recipient-policy payment events remain unsupported.

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

## 2. Create the Blueprint

1. Push `render.yaml` and `deploy/render/` to the GitHub branch Render will deploy.
2. In Render, select **New > Blueprint** and connect the repository.
3. Enter `KEYSTORE_PASSPHRASE` when prompted. Render generates `API_KEY` and connects
   `REDIS_URL` to the free Key Value service.
4. Create the Blueprint. The first deploy can fail until the secret file is installed.
5. Open `agentallowance-facilitator > Environment > Secret Files`.
6. Add a secret file named `local-signer.json` by uploading the encrypted local keystore.
7. Trigger **Manual Deploy > Deploy latest commit**.

The service URL has this facilitator endpoint:

```text
https://<render-service>.onrender.com/api/v1/plugins/x402-facilitator/call
```

## 3. Verify the deployment

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

Do not call `settle` during deployment verification. A further settlement requires an explicit
review of the exact amount, token, payer, merchant, facilitator URL, and successful verify response.

## Rollback and cleanup

1. Set the web service to **Suspended** or delete the Blueprint to remove both free resources.
2. Rotate or delete the Render `API_KEY` and `KEYSTORE_PASSPHRASE` values.
3. Delete the Render secret file.
4. If the encrypted keystore or passphrase was exposed, rotate the Testnet Relayer identity and
   redeploy. An encrypted keystore is not a backup of the Stellar secret key.

Render Free has no durable service guarantee. Keep the local Docker deployment as the deterministic
fallback for judging and demos.
