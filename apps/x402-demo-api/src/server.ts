import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { DemoPaymentStore } from "./store.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
dotenv.config({ path: path.join(root, ".env.local") });
dotenv.config({ path: path.join(root, ".env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

type Deployment = {
  token: string;
  smartAccount: string;
  merchant: string;
  unapprovedRecipient: string;
};

function latestDeployment(): Deployment {
  const latest = JSON.parse(readFileSync(path.join(root, "artifacts/testnet/latest.json"), "utf8")) as {
    runDirectory: string;
  };
  const runDirectory = path.isAbsolute(latest.runDirectory)
    ? latest.runDirectory
    : path.resolve(root, latest.runDirectory);
  return JSON.parse(readFileSync(path.join(runDirectory, "deployment.json"), "utf8")) as Deployment;
}

const port = Number(process.env.DEMO_API_PORT ?? "3001");
const publicBaseUrl = process.env.DEMO_SERVICE_URL ?? `http://127.0.0.1:${port}`;
const deployment = latestDeployment();
const app = createApp({
  network: "stellar:testnet",
  rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  assetContract: process.env.STELLAR_TOKEN_CONTRACT ?? deployment.token,
  treasuryContract: process.env.TREASURY_CONTRACT ?? deployment.smartAccount,
  merchant: process.env.STELLAR_MERCHANT_ADDRESS ?? deployment.merchant,
  unapprovedRecipient: process.env.STELLAR_UNAPPROVED_RECIPIENT_ADDRESS ?? deployment.unapprovedRecipient,
  amountAtomic: process.env.PAYMENT_AMOUNT ?? "100000",
  overLimitAmountAtomic: process.env.OVER_LIMIT_AMOUNT ?? "1000001",
  facilitatorUrl: required("X402_FACILITATOR_URL"),
  facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
  publicBaseUrl,
  store: new DemoPaymentStore(process.env.DEMO_DATABASE_URL ?? "./data/demo-api.db"),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`AgentAllowance x402 demo API listening on http://127.0.0.1:${info.port}`);
});
