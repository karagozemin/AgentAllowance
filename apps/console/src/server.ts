import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { AgentAllowance, SqliteEvidenceStore, type AllowanceRecord } from "@agentallowance/sdk";
import { createConsoleApp } from "./app.js";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
dotenv.config({ path: path.join(workspaceRoot, ".env.local") });
dotenv.config({ path: path.join(workspaceRoot, ".env") });

type Deployment = {
  admin: string;
  token: string;
  smartAccount: string;
  spendingPolicy: string;
  recipientPolicy: string;
  feePayer: string;
  delegate: string;
  delegate2?: string;
  merchant: string;
  unapprovedRecipient: string;
  allowanceRuleId?: number;
  validUntil?: number;
  spendingLimit?: string;
  periodLedgers?: number;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredInteger(name: string): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function serviceUrl(value: string): string {
  return /^https?:\/\//u.test(value) ? value : `https://${value}`;
}

function facilitatorUrl(): string {
  const explicit = process.env.X402_FACILITATOR_URL?.trim();
  if (explicit) return explicit;
  return `${serviceUrl(required("X402_FACILITATOR_HOST"))}/api/v1/plugins/x402-facilitator/call`;
}

function latestDeployment(): Deployment {
  const latest = JSON.parse(readFileSync(path.join(workspaceRoot, "artifacts/testnet/latest.json"), "utf8")) as {
    runDirectory: string;
  };
  const runDirectory = path.isAbsolute(latest.runDirectory)
    ? latest.runDirectory
    : path.resolve(workspaceRoot, latest.runDirectory);
  return JSON.parse(readFileSync(path.join(runDirectory, "deployment.json"), "utf8")) as Deployment;
}

function stellarSecret(alias: string): string {
  return execFileSync("stellar", ["--quiet", "keys", "secret", alias], {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function optionalKeypair(alias: string): Keypair | undefined {
  try { return Keypair.fromSecret(stellarSecret(alias)); } catch { return undefined; }
}

function keypairFromSecret(name: string): Keypair {
  try {
    return Keypair.fromSecret(required(name));
  } catch {
    throw new Error(`${name} is not a valid Stellar secret`);
  }
}

const hosted = Boolean(process.env.TREASURY_CONTRACT);
const admin = process.env.STELLAR_ADMIN_SECRET
  ? keypairFromSecret("STELLAR_ADMIN_SECRET")
  : Keypair.fromSecret(stellarSecret(process.env.STELLAR_ADMIN_IDENTITY ?? "agentallowance-admin"));
const source = process.env.STELLAR_FEE_PAYER_SECRET
  ? keypairFromSecret("STELLAR_FEE_PAYER_SECRET")
  : Keypair.fromSecret(stellarSecret(process.env.STELLAR_FEE_PAYER_IDENTITY ?? "agentallowance-fee-payer"));
const delegates = process.env.STELLAR_DELEGATE_SECRETS
  ? required("STELLAR_DELEGATE_SECRETS").split(",").map((secret, index) => {
      try { return Keypair.fromSecret(secret.trim()); } catch {
        throw new Error(`STELLAR_DELEGATE_SECRETS entry ${index + 1} is not a valid Stellar secret`);
      }
    })
  : [
      optionalKeypair(process.env.STELLAR_DELEGATE_IDENTITY ?? "agentallowance-delegate"),
      optionalKeypair(process.env.STELLAR_DELEGATE_2_IDENTITY ?? "agentallowance-delegate-2"),
    ].filter((value): value is Keypair => Boolean(value));
if (delegates.length === 0) throw new Error("At least one delegated signer is required");

const deployment: Deployment = hosted ? {
  admin: admin.publicKey(),
  token: required("STELLAR_TOKEN_CONTRACT"),
  smartAccount: required("TREASURY_CONTRACT"),
  spendingPolicy: required("SPENDING_POLICY_CONTRACT"),
  recipientPolicy: required("RECIPIENT_POLICY_CONTRACT"),
  feePayer: source.publicKey(),
  delegate: process.env.INITIAL_DELEGATED_SIGNER?.trim() || delegates[0]!.publicKey(),
  merchant: required("STELLAR_MERCHANT_ADDRESS"),
  unapprovedRecipient: required("STELLAR_UNAPPROVED_RECIPIENT_ADDRESS"),
  allowanceRuleId: process.env.INITIAL_ALLOWANCE_RULE_ID
    ? requiredInteger("INITIAL_ALLOWANCE_RULE_ID")
    : undefined,
  validUntil: process.env.INITIAL_ALLOWANCE_RULE_ID
    ? requiredInteger("INITIAL_ALLOWANCE_VALID_UNTIL_LEDGER")
    : undefined,
  spendingLimit: process.env.INITIAL_ALLOWANCE_RULE_ID ? required("SPENDING_LIMIT") : undefined,
  periodLedgers: process.env.INITIAL_ALLOWANCE_RULE_ID ? requiredInteger("PERIOD_LEDGERS") : undefined,
} : latestDeployment();

if (deployment.admin !== admin.publicKey()) throw new Error("Configured admin signer does not match deployment");
if (deployment.feePayer !== source.publicKey()) throw new Error("Configured fee payer does not match deployment");
if (!delegates.some((delegate) => delegate.publicKey() === deployment.delegate)) {
  throw new Error("INITIAL_DELEGATED_SIGNER does not match a configured delegated signer secret");
}
const store = new SqliteEvidenceStore(process.env.DATABASE_URL ?? path.join(workspaceRoot, "data/agentallowance.db"));
const configuredFacilitatorUrl = facilitatorUrl();

const agentAllowance = new AgentAllowance({
  network: "stellar:testnet",
  rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  assetContract: deployment.token,
  treasuryContract: deployment.smartAccount,
  spendingPolicy: deployment.spendingPolicy,
  recipientPolicy: deployment.recipientPolicy,
  facilitatorUrl: configuredFacilitatorUrl,
  facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
  transactionSource: source,
  adminSigner: admin,
  delegatedSigners: Object.fromEntries(delegates.map((delegate) => [delegate.publicKey(), delegate])),
  store,
});

if (deployment.allowanceRuleId !== undefined &&
    deployment.validUntil !== undefined &&
    deployment.spendingLimit !== undefined &&
    deployment.periodLedgers !== undefined &&
    !store.getAllowance(String(deployment.allowanceRuleId))) {
  const timestamp = new Date().toISOString();
  const initial: AllowanceRecord = {
    allowanceId: String(deployment.allowanceRuleId),
    label: "Primary research agent",
    network: "stellar:testnet",
    treasuryContract: deployment.smartAccount,
    assetContract: deployment.token,
    delegatedSigner: deployment.delegate,
    maxSpendAtomic: deployment.spendingLimit,
    spentAtomic: "0",
    windowLedgers: deployment.periodLedgers,
    allowedRecipients: [deployment.merchant],
    validUntilLedger: deployment.validUntil,
    contextRuleId: deployment.allowanceRuleId,
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.putAllowance(initial);
}

const rpcServer = new rpc.Server(process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org");
const app = createConsoleApp({
  agentAllowance,
  deployment,
  facilitatorUrl: configuredFacilitatorUrl,
  availableSigners: delegates.map((delegate) => delegate.publicKey()),
  demoServiceUrl: serviceUrl(process.env.DEMO_SERVICE_URL ?? "http://127.0.0.1:3001"),
  getLatestLedger: async () => Number((await rpcServer.getLatestLedger()).sequence),
  auth: {
    username: required("CONSOLE_AUTH_USERNAME"),
    password: required("CONSOLE_AUTH_PASSWORD"),
  },
});

const staticRoot = path.join(workspaceRoot, "apps/console/dist");
if (existsSync(staticRoot)) {
  app.use("/*", serveStatic({ root: staticRoot }));
  app.get("*", serveStatic({ path: path.join(staticRoot, "index.html") }));
}

const port = Number(process.env.PORT ?? process.env.CONSOLE_API_PORT ?? "3000");
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`AgentAllowance console API listening on http://127.0.0.1:${info.port}`);
});

export { app };
