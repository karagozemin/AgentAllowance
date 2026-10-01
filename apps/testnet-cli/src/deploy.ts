import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rpc } from "@stellar/stellar-sdk";
import {
  ALLOWANCE_LIFETIME_LEDGERS,
  FUND_AMOUNT,
  IDENTITIES,
  NETWORK,
  PAYMENT_AMOUNT,
  PERIOD_LEDGERS,
  RPC_URL,
  SPENDING_LIMIT,
  TOKEN,
} from "./config.js";
import {
  createRunDirectory,
  identityExists,
  stellar,
  workspaceRoot,
  writeJson,
  writeText,
} from "./runtime.js";

const wasm = {
  treasury: path.join(workspaceRoot, "target/wasm32v1-none/release/agentallowance_treasury_account.wasm"),
  spending: path.join(workspaceRoot, "target/wasm32v1-none/release/agentallowance_spending_limit_policy.wasm"),
  recipient: path.join(workspaceRoot, "target/wasm32v1-none/release/agentallowance_recipient_policy.wasm"),
};

function address(identity: string): string {
  return stellar(["keys", "address", identity], true);
}

function wasmHash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function deploy(file: string, alias: string, source: string, args: string[]): string {
  const output = stellar([
    "contract",
    "deploy",
    "--wasm",
    file,
    "--source-account",
    source,
    "--network",
    "testnet",
    "--alias",
    alias,
    "--",
    ...args,
  ]);
  const contractId = output.match(/C[A-Z2-7]{55}/)?.[0];
  if (!contractId) throw new Error(`No contract ID in Stellar CLI output: ${output}`);
  return contractId;
}

for (const identity of Object.values(IDENTITIES)) {
  if (!identityExists(identity)) {
    stellar(["keys", "generate", identity, "--fund", "--network", "testnet"]);
  }
}

stellar(["contract", "build"], true);
const latestLedger = await new rpc.Server(RPC_URL).getLatestLedger();
const validUntil = Number(latestLedger.sequence) + ALLOWANCE_LIFETIME_LEDGERS;
const feePayer = address(IDENTITIES.feePayer);
const relayer = address(IDENTITIES.relayer);
const admin = address(IDENTITIES.admin);
const delegate = address(IDENTITIES.delegate);
const delegate2 = address(IDENTITIES.delegate2);
const merchant = address(IDENTITIES.merchant);
const unapprovedRecipient = address(IDENTITIES.unapprovedRecipient);
const runDirectory = await createRunDirectory();

const spendingPolicy = deploy(wasm.spending, "agentallowance-spending-policy", IDENTITIES.feePayer, []);
const recipientPolicy = deploy(wasm.recipient, "agentallowance-recipient-policy", IDENTITIES.feePayer, []);
const smartAccount = deploy(wasm.treasury, "agentallowance-treasury", IDENTITIES.feePayer, [
  "--admin", admin,
  "--token", TOKEN,
  "--delegate", delegate,
  "--spending-policy", spendingPolicy,
  "--recipient-policy", recipientPolicy,
  "--spending-limit", SPENDING_LIMIT.toString(),
  "--period-ledgers", String(PERIOD_LEDGERS),
  "--recipient", merchant,
  "--valid-until", String(validUntil),
]);

const fundingOutput = stellar([
  "contract", "invoke", "--id", TOKEN,
  "--source-account", IDENTITIES.feePayer,
  "--network", "testnet", "--send", "yes", "--",
  "transfer", "--from", feePayer, "--to", smartAccount, "--amount", FUND_AMOUNT.toString(),
]);

const deployment = {
  createdAt: new Date().toISOString(),
  runDirectory,
  network: NETWORK,
  rpcUrl: RPC_URL,
  token: TOKEN,
  feePayer,
  relayer,
  admin,
  delegate,
  delegate2,
  merchant,
  unapprovedRecipient,
  spendingPolicy,
  recipientPolicy,
  smartAccount,
  adminRuleId: 0,
  allowanceRuleId: 1,
  validUntil,
  fundAmount: FUND_AMOUNT.toString(),
  paymentAmount: PAYMENT_AMOUNT.toString(),
  spendingLimit: SPENDING_LIMIT.toString(),
  periodLedgers: PERIOD_LEDGERS,
  assetCode: process.env.STELLAR_ASSET_CODE ?? "XLM",
  assetDecimals: Number(process.env.STELLAR_ASSET_DECIMALS ?? "7"),
  wasmHashes: {
    treasury: wasmHash(wasm.treasury),
    spendingPolicy: wasmHash(wasm.spending),
    recipientPolicy: wasmHash(wasm.recipient),
  },
};
await writeJson(runDirectory, "deployment.json", deployment);
await writeJson(runDirectory, "policy-manifest.json", {
  id: `agentallowance-testnet-${path.basename(runDirectory)}`,
  network: NETWORK,
  smartAccount,
  expectedRuleId: 1,
  adapters: [{
    kind: "openzeppelin-stellar-accounts/spending-limit@0.7.2",
    contractId: spendingPolicy,
    expectedWasmHash: deployment.wasmHashes.spendingPolicy,
    required: true,
  }],
});
await writeText(runDirectory, "funding-cli-output.txt", fundingOutput);
console.log(JSON.stringify(deployment, null, 2));
