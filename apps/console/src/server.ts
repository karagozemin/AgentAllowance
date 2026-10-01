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
  token: string;
  smartAccount: string;
  spendingPolicy: string;
  recipientPolicy: string;
  feePayer: string;
  delegate: string;
  delegate2?: string;
  merchant: string;
  unapprovedRecipient: string;
  allowanceRuleId: number;
  validUntil: number;
  spendingLimit: string;
  periodLedgers: number;
};

function latestDeployment(): Deployment {
  const latest = JSON.parse(readFileSync(path.join(workspaceRoot, "artifacts/testnet/latest.json"), "utf8")) as {
    runDirectory: string;
  };
  return JSON.parse(readFileSync(path.join(latest.runDirectory, "deployment.json"), "utf8")) as Deployment;
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

const deployment = latestDeployment();
const admin = Keypair.fromSecret(stellarSecret(process.env.STELLAR_ADMIN_IDENTITY ?? "agentallowance-admin"));
const source = Keypair.fromSecret(stellarSecret(process.env.STELLAR_FEE_PAYER_IDENTITY ?? "agentallowance-fee-payer"));
const delegates = [
  optionalKeypair(process.env.STELLAR_DELEGATE_IDENTITY ?? "agentallowance-delegate"),
  optionalKeypair(process.env.STELLAR_DELEGATE_2_IDENTITY ?? "agentallowance-delegate-2"),
].filter((value): value is Keypair => Boolean(value));
const store = new SqliteEvidenceStore(process.env.DATABASE_URL ?? path.join(workspaceRoot, "data/agentallowance.db"));
const facilitatorUrl = process.env.X402_FACILITATOR_URL;
if (!facilitatorUrl) throw new Error("X402_FACILITATOR_URL is required");

const agentAllowance = new AgentAllowance({
  network: "stellar:testnet",
  rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  assetContract: deployment.token,
  treasuryContract: deployment.smartAccount,
  spendingPolicy: deployment.spendingPolicy,
  recipientPolicy: deployment.recipientPolicy,
  facilitatorUrl,
  facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
  transactionSource: source,
  adminSigner: admin,
  delegatedSigners: Object.fromEntries(delegates.map((delegate) => [delegate.publicKey(), delegate])),
  store,
});

if (!store.getAllowance(String(deployment.allowanceRuleId))) {
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
  facilitatorUrl,
  availableSigners: delegates.map((delegate) => delegate.publicKey()),
  demoServiceUrl: process.env.DEMO_SERVICE_URL ?? "http://127.0.0.1:3001",
  getLatestLedger: async () => Number((await rpcServer.getLatestLedger()).sequence),
});

const staticRoot = path.join(workspaceRoot, "apps/console/dist");
if (existsSync(staticRoot)) {
  app.use("/*", serveStatic({ root: staticRoot }));
  app.get("*", serveStatic({ path: path.join(staticRoot, "index.html") }));
}

const port = Number(process.env.CONSOLE_API_PORT ?? "3000");
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`AgentAllowance console API listening on http://127.0.0.1:${info.port}`);
});

export { app };
