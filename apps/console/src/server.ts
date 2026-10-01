import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Asset, Keypair, Networks, rpc } from "@stellar/stellar-sdk";
import {
  AgentAllowance,
  SqliteEvidenceStore,
  prepareCreateContextRuleAuthorization,
  prepareRevokeContextRuleAuthorization,
  submitWalletAdminCall,
  type AdminConfig,
  type AllowanceCreateInput,
  type AllowanceRecord,
  type PreparedWalletAdminCall,
} from "@agentallowance/sdk";
import { createConsoleApp } from "./app.js";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
dotenv.config({ path: path.join(workspaceRoot, ".env.local") });
dotenv.config({ path: path.join(workspaceRoot, ".env") });

type Deployment = {
  admin: string;
  token: string;
  assetCode?: string;
  assetDecimals?: number;
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
  const secret = required(name);
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new Error(`${name} is not a valid Stellar secret`);
  }
}

const hosted = process.env.NODE_ENV === "production" ||
  Boolean(process.env.RENDER_SERVICE_ID) ||
  Boolean(process.env.TREASURY_CONTRACT);
const adminSigner = hosted
  ? (process.env.STELLAR_ADMIN_SECRET?.trim() ? keypairFromSecret("STELLAR_ADMIN_SECRET") : undefined)
  : Keypair.fromSecret(stellarSecret(process.env.STELLAR_ADMIN_IDENTITY ?? "agentallowance-admin"));
const adminAddress = process.env.STELLAR_ADMIN_ADDRESS?.trim() || adminSigner?.publicKey();
if (!adminAddress) throw new Error("STELLAR_ADMIN_ADDRESS is required when no server admin signer is configured");
const source = hosted || process.env.STELLAR_FEE_PAYER_SECRET
  ? keypairFromSecret("STELLAR_FEE_PAYER_SECRET")
  : Keypair.fromSecret(stellarSecret(process.env.STELLAR_FEE_PAYER_IDENTITY ?? "agentallowance-fee-payer"));
const delegates = hosted || process.env.STELLAR_DELEGATE_SECRETS
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
  admin: adminAddress,
  token: required("STELLAR_TOKEN_CONTRACT"),
  assetCode: process.env.STELLAR_ASSET_CODE?.trim() || "XLM",
  assetDecimals: process.env.STELLAR_ASSET_DECIMALS ? requiredInteger("STELLAR_ASSET_DECIMALS") : 7,
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
deployment.assetCode ??= deployment.token === Asset.native().contractId(Networks.TESTNET) ? "XLM" : "USDC";
deployment.assetDecimals ??= 7;

if (deployment.admin !== adminAddress) throw new Error("Configured admin address does not match deployment");
if (adminSigner && deployment.admin !== adminSigner.publicKey()) throw new Error("Configured admin signer does not match deployment");
if (deployment.feePayer !== source.publicKey()) throw new Error("Configured fee payer does not match deployment");
if (!delegates.some((delegate) => delegate.publicKey() === deployment.delegate)) {
  throw new Error("INITIAL_DELEGATED_SIGNER does not match a configured delegated signer secret");
}
const store = new SqliteEvidenceStore(
  process.env.DATABASE_URL ?? path.join(workspaceRoot, "data", `agentallowance-${deployment.smartAccount}.db`),
);
const configuredFacilitatorUrl = facilitatorUrl();
const networkPassphrase = "Test SDF Network ; September 2015";
const adminConfig: AdminConfig = {
  rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  networkPassphrase,
  treasuryContract: deployment.smartAccount,
  assetContract: deployment.token,
  spendingPolicy: deployment.spendingPolicy,
  recipientPolicy: deployment.recipientPolicy,
  adminAddress,
  adminSigner,
  transactionSource: source,
};

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
  adminAddress,
  adminSigner,
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
type PendingAdminOperation = {
  kind: "create" | "revoke";
  prepared: PreparedWalletAdminCall;
  expiresAt: number;
  input?: AllowanceCreateInput & { windowLedgers: number; validUntilLedger: number };
  allowanceId?: string;
};
const pendingAdminOperations = new Map<string, PendingAdminOperation>();

function takePending(operationId: string, kind: PendingAdminOperation["kind"]): PendingAdminOperation {
  const pending = pendingAdminOperations.get(operationId);
  pendingAdminOperations.delete(operationId);
  if (!pending || pending.kind !== kind || pending.expiresAt < Date.now()) {
    throw new Error("Prepared wallet authorization is missing or expired");
  }
  return pending;
}

const app = createConsoleApp({
  agentAllowance,
  deployment,
  facilitatorUrl: configuredFacilitatorUrl,
  availableSigners: delegates.map((delegate) => delegate.publicKey()),
  demoServiceUrl: serviceUrl(process.env.DEMO_SERVICE_URL ?? "http://127.0.0.1:3001"),
  getLatestLedger: async () => Number((await rpcServer.getLatestLedger()).sequence),
  publicDemo: {
    allowanceId: process.env.PUBLIC_DEMO_ALLOWANCE_ID?.trim() || (deployment.allowanceRuleId ? String(deployment.allowanceRuleId) : undefined),
    successCooldownMs: Number(process.env.PUBLIC_DEMO_SUCCESS_COOLDOWN_MS ?? "3600000"),
  },
  walletAdmin: {
    prepareCreate: async (input) => {
      if (!input.label.trim() || input.allowedRecipients.length !== 1) throw new Error("One label and recipient are required");
      if (!delegates.some((value) => value.publicKey() === input.delegatedSigner)) throw new Error("Delegated signer is not configured");
      if (!/^\d+$/u.test(input.maxSpendAtomic) || BigInt(input.maxSpendAtomic) <= 0n) throw new Error("Budget must be positive atomic units");
      const latest = Number((await rpcServer.getLatestLedger()).sequence);
      const windowLedgers = Math.ceil(input.windowSeconds / 5);
      const validUntilLedger = latest + Math.ceil(input.expiresInSeconds / 5);
      const prepared = await prepareCreateContextRuleAuthorization(adminConfig, {
        label: input.label,
        delegatedSigner: input.delegatedSigner,
        maxSpendAtomic: BigInt(input.maxSpendAtomic),
        windowLedgers,
        recipient: input.allowedRecipients[0]!,
        validUntilLedger,
      });
      const operationId = randomUUID();
      pendingAdminOperations.set(operationId, {
        kind: "create", prepared, expiresAt: Date.now() + 60_000,
        input: { ...input, windowLedgers, validUntilLedger },
      });
      return { operationId, authEntryXdr: prepared.unsignedAdminEntryXdr };
    },
    submitCreate: async (operationId, signedAuthEntryXdr) => {
      const pending = takePending(operationId, "create");
      const result = await submitWalletAdminCall(adminConfig, pending.prepared, signedAuthEntryXdr);
      const context = result.retval as { id?: unknown };
      if (!Number.isInteger(context.id) || !pending.input) throw new Error("Created rule did not return a context rule ID");
      const timestamp = new Date().toISOString();
      const record: AllowanceRecord = {
        allowanceId: String(context.id), label: pending.input.label, network: "stellar:testnet",
        treasuryContract: deployment.smartAccount, assetContract: deployment.token,
        delegatedSigner: pending.input.delegatedSigner, maxSpendAtomic: pending.input.maxSpendAtomic,
        spentAtomic: "0", windowLedgers: pending.input.windowLedgers,
        allowedRecipients: [...pending.input.allowedRecipients], validUntilLedger: pending.input.validUntilLedger,
        contextRuleId: Number(context.id), createTxHash: result.transactionHash, status: "ACTIVE",
        createdAt: timestamp, updatedAt: timestamp,
      };
      store.putAllowance(record);
      return record;
    },
    prepareRevoke: async (allowanceId) => {
      const record = store.getAllowance(allowanceId);
      if (!record) throw new Error("Allowance not found");
      const prepared = await prepareRevokeContextRuleAuthorization(adminConfig, record.contextRuleId);
      const operationId = randomUUID();
      pendingAdminOperations.set(operationId, { kind: "revoke", prepared, allowanceId, expiresAt: Date.now() + 60_000 });
      return { operationId, authEntryXdr: prepared.unsignedAdminEntryXdr };
    },
    submitRevoke: async (operationId, signedAuthEntryXdr) => {
      const pending = takePending(operationId, "revoke");
      const record = pending.allowanceId ? store.getAllowance(pending.allowanceId) : undefined;
      if (!record) throw new Error("Allowance not found");
      const result = await submitWalletAdminCall(adminConfig, pending.prepared, signedAuthEntryXdr);
      const updated: AllowanceRecord = { ...record, status: "REVOKED", revokeTxHash: result.transactionHash, updatedAt: new Date().toISOString() };
      store.putAllowance(updated);
      return updated;
    },
  },
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
