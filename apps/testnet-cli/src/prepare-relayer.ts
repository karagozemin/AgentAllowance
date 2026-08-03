import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { IDENTITIES } from "./config.js";
import { latestRunDirectory, stellar, workspaceRoot } from "./runtime.js";

type Deployment = {
  token: string;
  relayer: string;
  recipientPolicy: string;
  wasmHashes: { treasury: string; recipientPolicy: string };
};

const runDirectory = await latestRunDirectory();
const deployment = JSON.parse(await readFile(path.join(runDirectory, "deployment.json"), "utf8")) as Deployment;
const sourceManifest = JSON.parse(await readFile(path.join(runDirectory, "policy-manifest.json"), "utf8")) as {
  id: string;
  network: "stellar:testnet";
  adapters: unknown[];
};
const manifest = {
  id: sourceManifest.id,
  network: sourceManifest.network,
  smartAccountWasmHash: deployment.wasmHashes.treasury,
  recipientPolicy: {
    contractId: deployment.recipientPolicy,
    expectedWasmHash: deployment.wasmHashes.recipientPolicy,
  },
  adapters: sourceManifest.adapters,
};
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runtimeDirectory = path.join(workspaceRoot, "artifacts/local/relayer/runs", timestamp);
const configDirectory = path.join(runtimeDirectory, "config");
const keysDirectory = path.join(configDirectory, "keys");
const pluginDirectory = path.join(runtimeDirectory, "plugin");
await mkdir(keysDirectory, { recursive: true });
await mkdir(pluginDirectory, { recursive: true });

const keystorePassphrase = `Aa1!${randomBytes(24).toString("hex")}`;
const apiKey = randomUUID();
const relayerSecret = stellar(["keys", "secret", IDENTITIES.relayer], true);
const keystore = spawnSync(
  "cargo",
  [
    "run", "--quiet", "--manifest-path", path.join(workspaceRoot, "tools/relayer-keystore/Cargo.toml"), "--",
    keysDirectory, "local-signer.json",
  ],
  {
    cwd: workspaceRoot,
    encoding: "utf8",
    input: `${relayerSecret}\n`,
    env: { ...process.env, RELAYER_KEYSTORE_PASSPHRASE: keystorePassphrase },
  },
);
if (keystore.status !== 0) {
  throw new Error(`OpenZeppelin keystore generation failed: ${keystore.stderr}`);
}
await chmod(path.join(keysDirectory, "local-signer.json"), 0o500);

execFileSync(
  "pnpm",
  [
    "exec", "esbuild", path.join(workspaceRoot, "packages/relayer-plugin-x402-facilitator/src/index.ts"),
    "--bundle", "--platform=node", "--format=cjs",
    "--external:@openzeppelin/relayer-sdk",
    // Relayer 1.7 validates the configured plugin path as TypeScript, then
    // loads it through ts-node/CommonJS. The bundled output remains CommonJS.
    `--outfile=${path.join(pluginDirectory, "index.ts")}`,
  ],
  { cwd: workspaceRoot, stdio: "inherit" },
);

await mkdir(path.join(configDirectory, "networks"), { recursive: true });
await copyFile(
  path.join(workspaceRoot, "deploy/relayer/stellar.json"),
  path.join(configDirectory, "networks", "stellar.json"),
);
const config = {
  relayers: [{
    id: "agentallowance-testnet",
    name: "AgentAllowance Testnet",
    network: "testnet",
    paused: false,
    network_type: "stellar",
    signer_id: "agentallowance-local-signer",
    policies: { fee_payment_strategy: "relayer", min_balance: 0 },
  }],
  notifications: [],
  signers: [{
    id: "agentallowance-local-signer",
    type: "local",
    config: {
      path: "config/keys/local-signer.json",
      passphrase: { type: "env", value: "KEYSTORE_PASSPHRASE" },
    },
  }],
  networks: "./config/networks",
  plugins: [{
    id: "x402-facilitator",
    path: "x402-facilitator/index.ts",
    timeout: 30,
    emit_logs: true,
    emit_traces: true,
    forward_logs: true,
    raw_response: true,
    allow_get_invocation: true,
    config: {
      networks: [{
        network: "stellar:testnet",
        type: "stellar",
        relayer_id: "agentallowance-testnet",
        assets: [deployment.token],
        maxTransactionFeeStroops: "2000000",
        policy_manifests: [manifest],
      }],
    },
  }],
};
await writeFile(path.join(configDirectory, "config.json"), `${JSON.stringify(config, null, 2)}\n`);

const facilitatorUrl = "http://127.0.0.1:8080/api/v1/plugins/x402-facilitator/call";
const runtimeEnv = [
  `RELAYER_RUNTIME_DIR=${runtimeDirectory}`,
  `RELAYER_API_KEY=${apiKey}`,
  `RELAYER_KEYSTORE_PASSPHRASE=${keystorePassphrase}`,
  `X402_FACILITATOR_URL=${facilitatorUrl}`,
  `X402_FACILITATOR_API_KEY=${apiKey}`,
  "",
].join("\n");
const localRelayerDirectory = path.join(workspaceRoot, "artifacts/local/relayer");
await mkdir(localRelayerDirectory, { recursive: true });
await writeFile(path.join(localRelayerDirectory, "latest.env"), runtimeEnv, { mode: 0o600 });
await writeFile(
  path.join(localRelayerDirectory, "latest.json"),
  `${JSON.stringify({ runtimeDirectory, facilitatorUrl, relayer: deployment.relayer }, null, 2)}\n`,
);

console.log(JSON.stringify({ runtimeDirectory, facilitatorUrl, relayer: deployment.relayer }, null, 2));
