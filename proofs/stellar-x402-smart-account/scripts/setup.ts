import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  FUND_AMOUNT,
  IDENTITIES,
  NETWORK,
  PERIOD_LEDGERS,
  PAYMENT_AMOUNT,
  RPC_URL,
  SPENDING_LIMIT,
  TOKEN,
} from "./lib/config.js";
import { createRunDirectory, writeJson, writeText } from "./lib/artifacts.js";
import { identityExists, stellar } from "./lib/cli.js";

function address(name: string): string {
  return stellar(["keys", "address", name], { quiet: true });
}

function deploy(wasm: string, source: string, args: string[]): string {
  const output = stellar([
    "contract",
    "deploy",
    "--wasm",
    wasm,
    "--source-account",
    source,
    "--network",
    "testnet",
    "--alias",
    path.basename(wasm, ".wasm"),
    "--",
    ...args,
  ]);
  const found = output.match(/C[A-Z2-7]{55}/)?.[0];
  if (!found) throw new Error(`Could not find deployed contract ID in CLI output:\n${output}`);
  return found;
}

for (const name of Object.values(IDENTITIES)) {
  if (!identityExists(name)) {
    stellar(["keys", "generate", name, "--fund", "--network", "testnet"]);
  }
}

stellar(["contract", "build"], { quiet: true });
const runDirectory = await createRunDirectory();
const feePayer = address(IDENTITIES.feePayer);
const delegate = address(IDENTITIES.delegate);
const merchant = address(IDENTITIES.merchant);

const policy = deploy(
  "target/wasm32v1-none/release/x402_proof_spending_limit_policy.wasm",
  IDENTITIES.feePayer,
  [],
);
const smartAccount = deploy(
  "target/wasm32v1-none/release/x402_proof_smart_account.wasm",
  IDENTITIES.feePayer,
  [
    "--token",
    TOKEN,
    "--delegate",
    delegate,
    "--policy",
    policy,
    "--spending-limit",
    SPENDING_LIMIT.toString(),
    "--period-ledgers",
    PERIOD_LEDGERS.toString(),
  ],
);

const fundingOutput = stellar([
  "contract",
  "invoke",
  "--id",
  TOKEN,
  "--source-account",
  IDENTITIES.feePayer,
  "--network",
  "testnet",
  "--send",
  "yes",
  "--",
  "transfer",
  "--from",
  feePayer,
  "--to",
  smartAccount,
  "--amount",
  FUND_AMOUNT.toString(),
]);

const deployment = {
  createdAt: new Date().toISOString(),
  runDirectory,
  network: NETWORK,
  rpcUrl: RPC_URL,
  token: TOKEN,
  feePayer,
  delegate,
  merchant,
  policy,
  smartAccount,
  ruleId: 0,
  fundAmount: FUND_AMOUNT.toString(),
  paymentAmount: PAYMENT_AMOUNT.toString(),
  spendingLimit: SPENDING_LIMIT.toString(),
  periodLedgers: PERIOD_LEDGERS,
};
await writeJson(runDirectory, "deployment.json", deployment);
await writeText(runDirectory, "funding-cli-output.txt", fundingOutput);
await mkdir(path.join(runDirectory, "simulation"), { recursive: true });
console.log(JSON.stringify({ ...deployment, runDirectory }, null, 2));

