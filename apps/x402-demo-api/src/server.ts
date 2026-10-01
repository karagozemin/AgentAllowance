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

function serviceUrl(value: string): string {
  return /^https?:\/\//u.test(value) ? value : `https://${value}`;
}

function facilitatorUrl(): string {
  const explicit = process.env.X402_FACILITATOR_URL?.trim();
  if (explicit) return explicit;
  return `${serviceUrl(required("X402_FACILITATOR_HOST"))}/api/v1/plugins/x402-facilitator/call`;
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

const port = Number(process.env.PORT ?? process.env.DEMO_API_PORT ?? "3001");
const publicBaseUrl = (process.env.DEMO_SERVICE_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${port}`)
  .replace(/\/$/u, "");
const hosted = process.env.NODE_ENV === "production" ||
  Boolean(process.env.RENDER_SERVICE_ID) ||
  Boolean(process.env.TREASURY_CONTRACT);
const deployment = hosted ? {
  token: required("STELLAR_TOKEN_CONTRACT"),
  smartAccount: required("TREASURY_CONTRACT"),
  merchant: required("STELLAR_MERCHANT_ADDRESS"),
  unapprovedRecipient: required("STELLAR_UNAPPROVED_RECIPIENT_ADDRESS"),
} : latestDeployment();
const app = createApp({
  network: "stellar:testnet",
  rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  assetContract: process.env.STELLAR_TOKEN_CONTRACT ?? deployment.token,
  treasuryContract: process.env.TREASURY_CONTRACT ?? deployment.smartAccount,
  merchant: process.env.STELLAR_MERCHANT_ADDRESS ?? deployment.merchant,
  unapprovedRecipient: process.env.STELLAR_UNAPPROVED_RECIPIENT_ADDRESS ?? deployment.unapprovedRecipient,
  amountAtomic: process.env.PAYMENT_AMOUNT ?? "100000",
  overLimitAmountAtomic: process.env.OVER_LIMIT_AMOUNT ?? "1000001",
  facilitatorUrl: facilitatorUrl(),
  facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
  publicBaseUrl,
  store: new DemoPaymentStore(process.env.DEMO_DATABASE_URL ?? "./data/demo-api.db"),
});

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`AgentAllowance x402 demo API listening on http://127.0.0.1:${info.port}`);
});
