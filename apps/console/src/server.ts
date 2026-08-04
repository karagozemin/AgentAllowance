import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Address, Asset, Keypair, Networks, rpc, xdr } from "@stellar/stellar-sdk";
import { serviceOrigin } from "@agentallowance/shared";
import {
  AgentAllowance,
  SqliteEvidenceStore,
  deployDeterministicTreasury,
  deterministicTreasuryContractId,
  fundTreasuryFromSponsor,
  prepareCreateContextRuleAuthorization,
  prepareRevokeContextRuleAuthorization,
  readContractValue,
  submitWalletAdminCall,
  treasuryExists,
  type AdminConfig,
  type AllowanceCreateInput,
  type AllowanceRecord,
  type PreparedWalletAdminCall,
  type TreasuryDeploymentConfig,
} from "@agentallowance/sdk";
import { createConsoleApp, type OwnerConsoleScope, type OwnerProfile } from "./app.js";
import { fundOwnerTreasuryToTarget } from "./owner-funding.js";
import { PendingOwnerOperations } from "./owner-operations.js";

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
  wasmHashes?: { treasury?: string; spendingPolicy?: string; recipientPolicy?: string };
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

function integerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function bigintEnv(name: string, fallback: string): bigint {
  const raw = process.env[name]?.trim() || fallback;
  if (!/^\d+$/u.test(raw)) throw new Error(`${name} must contain atomic units`);
  return BigInt(raw);
}

function facilitatorUrl(): string {
  const explicit = process.env.X402_FACILITATOR_URL?.trim();
  if (explicit) return explicit;
  return `${serviceOrigin(required("X402_FACILITATOR_HOST"))}/api/v1/plugins/x402-facilitator/call`;
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
  try { return Keypair.fromSecret(required(name)); } catch { throw new Error(`${name} is not a valid Stellar secret`); }
}

const hosted = process.env.NODE_ENV === "production" ||
  Boolean(process.env.RENDER_SERVICE_ID) ||
  Boolean(process.env.TREASURY_CONTRACT);
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

const hostedAdminSigner = process.env.STELLAR_ADMIN_SECRET?.trim()
  ? keypairFromSecret("STELLAR_ADMIN_SECRET")
  : undefined;
const deployment: Deployment = hosted ? {
  admin: required("STELLAR_ADMIN_ADDRESS"),
  token: required("STELLAR_TOKEN_CONTRACT"),
  assetCode: process.env.STELLAR_ASSET_CODE?.trim() || "USDC",
  assetDecimals: process.env.STELLAR_ASSET_DECIMALS ? requiredInteger("STELLAR_ASSET_DECIMALS") : 7,
  smartAccount: required("TREASURY_CONTRACT"),
  spendingPolicy: required("SPENDING_POLICY_CONTRACT"),
  recipientPolicy: required("RECIPIENT_POLICY_CONTRACT"),
  feePayer: source.publicKey(),
  delegate: process.env.INITIAL_DELEGATED_SIGNER?.trim() || delegates[0]!.publicKey(),
  merchant: required("STELLAR_MERCHANT_ADDRESS"),
  unapprovedRecipient: required("STELLAR_UNAPPROVED_RECIPIENT_ADDRESS"),
  allowanceRuleId: process.env.INITIAL_ALLOWANCE_RULE_ID ? requiredInteger("INITIAL_ALLOWANCE_RULE_ID") : undefined,
  validUntil: process.env.INITIAL_ALLOWANCE_RULE_ID ? requiredInteger("INITIAL_ALLOWANCE_VALID_UNTIL_LEDGER") : undefined,
  spendingLimit: process.env.INITIAL_ALLOWANCE_RULE_ID ? required("SPENDING_LIMIT") : undefined,
  periodLedgers: process.env.INITIAL_ALLOWANCE_RULE_ID ? requiredInteger("PERIOD_LEDGERS") : undefined,
  wasmHashes: { treasury: required("TREASURY_WASM_HASH") },
} : latestDeployment();
deployment.assetCode ??= deployment.token === Asset.native().contractId(Networks.TESTNET) ? "XLM" : "USDC";
deployment.assetDecimals ??= 7;

if (deployment.feePayer !== source.publicKey()) throw new Error("Configured fee payer does not match deployment");
if (hostedAdminSigner && hostedAdminSigner.publicKey() !== deployment.admin) {
  throw new Error("Configured public-demo admin signer does not match deployment");
}
if (!delegates.some((delegate) => delegate.publicKey() === deployment.delegate)) {
  throw new Error("INITIAL_DELEGATED_SIGNER does not match a configured delegated signer secret");
}
const treasuryWasmHash = (() => {
  const value = deployment.wasmHashes?.treasury;
  if (!value || !/^[0-9a-f]{64}$/iu.test(value)) {
    throw new Error("TREASURY_WASM_HASH is required for wallet-owned treasury onboarding");
  }
  return value;
})();

const rpcUrl = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const horizonUrl = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const networkPassphrase = Networks.TESTNET;
const configuredFacilitatorUrl = facilitatorUrl();
const rpcServer = new rpc.Server(rpcUrl);
const delegatedSigners = Object.fromEntries(delegates.map((delegate) => [delegate.publicKey(), delegate]));
const demoServiceUrl = serviceOrigin(process.env.DEMO_SERVICE_URL ?? "http://127.0.0.1:3001");

function makeAgentAllowance(options: {
  treasury: string;
  adminAddress: string;
  adminSigner?: Keypair;
  store: SqliteEvidenceStore;
}): AgentAllowance {
  return new AgentAllowance({
    network: "stellar:testnet",
    rpcUrl,
    horizonUrl,
    assetContract: deployment.token,
    treasuryContract: options.treasury,
    spendingPolicy: deployment.spendingPolicy,
    recipientPolicy: deployment.recipientPolicy,
    facilitatorUrl: configuredFacilitatorUrl,
    facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
    transactionSource: source,
    adminAddress: options.adminAddress,
    adminSigner: options.adminSigner,
    delegatedSigners,
    store: options.store,
  });
}

function putInitialRecord(store: SqliteEvidenceStore, values: {
  treasury: string;
  delegate: string;
  validUntil: number;
  spendingLimit: string;
  periodLedgers: number;
  merchant: string;
  transactionHash?: string;
}): void {
  if (store.getAllowance("1")) return;
  const timestamp = new Date().toISOString();
  store.putAllowance({
    allowanceId: "1",
    label: "Initial autonomous agent",
    network: "stellar:testnet",
    treasuryContract: values.treasury,
    assetContract: deployment.token,
    delegatedSigner: values.delegate,
    maxSpendAtomic: values.spendingLimit,
    spentAtomic: "0",
    windowLedgers: values.periodLedgers,
    allowedRecipients: [values.merchant],
    validUntilLedger: values.validUntil,
    contextRuleId: 1,
    createTxHash: values.transactionHash,
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

const publicStore = new SqliteEvidenceStore(
  process.env.DATABASE_URL ?? path.join(workspaceRoot, "data", `agentallowance-${deployment.smartAccount}.db`),
);
const publicAgentAllowance = makeAgentAllowance({
  treasury: deployment.smartAccount,
  adminAddress: deployment.admin,
  adminSigner: hostedAdminSigner,
  store: publicStore,
});
if (deployment.allowanceRuleId === 1 && deployment.validUntil !== undefined &&
    deployment.spendingLimit !== undefined && deployment.periodLedgers !== undefined) {
  putInitialRecord(publicStore, {
    treasury: deployment.smartAccount,
    delegate: deployment.delegate,
    validUntil: deployment.validUntil,
    spendingLimit: deployment.spendingLimit,
    periodLedgers: deployment.periodLedgers,
    merchant: deployment.merchant,
  });
}

const ownerInitialLimit = bigintEnv("OWNER_INITIAL_SPENDING_LIMIT", "1000000");
const ownerPeriodLedgers = integerEnv("OWNER_PERIOD_LEDGERS", 720);
const ownerLifetimeLedgers = integerEnv("OWNER_ALLOWANCE_LIFETIME_LEDGERS", 17_280);
const ownerFundingTarget = bigintEnv(
  "OWNER_TREASURY_TARGET_BALANCE_ATOMIC",
  process.env.OWNER_INITIAL_FUNDING_ATOMIC?.trim() || "0",
);
const ownerDatabaseDirectory = process.env.OWNER_DATABASE_DIRECTORY?.trim() || path.join(workspaceRoot, "data");
const ownerDelegate = process.env.OWNER_DELEGATED_SIGNER?.trim() || delegates[0]!.publicKey();
if (!delegatedSigners[ownerDelegate]) throw new Error("OWNER_DELEGATED_SIGNER has no configured secret");

function ownerDeploymentConfig(validUntilLedger: number): TreasuryDeploymentConfig {
  return {
    rpcUrl,
    horizonUrl,
    networkPassphrase,
    transactionSource: source,
    treasuryWasmHash,
    assetContract: deployment.token,
    spendingPolicy: deployment.spendingPolicy,
    recipientPolicy: deployment.recipientPolicy,
    delegatedSigner: ownerDelegate,
    recipient: deployment.merchant,
    initialSpendingLimit: ownerInitialLimit,
    periodLedgers: ownerPeriodLedgers,
    validUntilLedger,
    deploymentVersion: process.env.OWNER_TREASURY_VERSION?.trim() || "treasury-v1",
  };
}

function ownerTreasury(owner: string): string {
  return deterministicTreasuryContractId(owner, ownerDeploymentConfig(1));
}

let sourceQueue: Promise<void> = Promise.resolve();
function serializeSource<T>(operation: () => Promise<T>): Promise<T> {
  const result = sourceQueue.then(operation, operation);
  sourceQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function ensureOwnerTreasuryFunding(treasury: string): Promise<string | undefined> {
  const result = await fundOwnerTreasuryToTarget({
    targetBalanceAtomic: ownerFundingTarget,
    readBalance: async () => String(await readContractValue({
      rpcUrl,
      networkPassphrase,
      transactionSource: source.publicKey(),
      contractId: deployment.token,
      method: "balance",
      args: [Address.fromString(treasury).toScVal()],
    })),
    fund: (amount) => serializeSource(() => fundTreasuryFromSponsor({
      rpcUrl,
      horizonUrl,
      networkPassphrase,
      transactionSource: source,
      assetContract: deployment.token,
      treasuryContract: treasury,
      amount,
    })),
  });
  return result.transactionHash;
}

type PendingAdminOperation = {
  owner: string;
  kind: "create" | "revoke";
  prepared: PreparedWalletAdminCall;
  expiresAt: number;
  input?: AllowanceCreateInput & { windowLedgers: number; validUntilLedger: number };
  allowanceId?: string;
};
const pendingAdminOperations = new PendingOwnerOperations<PendingAdminOperation>();
const ownerProfiles = new Map<string, OwnerProfile>();
const ownerScopes = new Map<string, Promise<OwnerConsoleScope>>();

function takePending(operationId: string, kind: PendingAdminOperation["kind"], owner: string): PendingAdminOperation {
  return pendingAdminOperations.take(operationId, kind, owner);
}

function findAddress(value: unknown, prefix: "G" | "C"): string | undefined {
  if (typeof value === "string" && value.startsWith(prefix)) return value;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findAddress(item, prefix); if (found) return found; }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = findAddress(item, prefix); if (found) return found;
    }
  }
  return undefined;
}

async function hydrateOwnerStore(treasury: string, store: SqliteEvidenceStore): Promise<void> {
  let count = 0;
  try {
    count = Number(await readContractValue({
      rpcUrl, networkPassphrase, transactionSource: source.publicKey(), contractId: treasury,
      method: "get_context_rules_count", args: [],
    }));
  } catch { return; }
  for (let contextRuleId = 1; contextRuleId < count; contextRuleId += 1) {
    if (store.getAllowance(String(contextRuleId))) continue;
    try {
      const [rule, spending, recipient] = await Promise.all([
        readContractValue({
          rpcUrl, networkPassphrase, transactionSource: source.publicKey(), contractId: treasury,
          method: "get_context_rule", args: [xdr.ScVal.scvU32(contextRuleId)],
        }),
        readContractValue({
          rpcUrl, networkPassphrase, transactionSource: source.publicKey(), contractId: deployment.spendingPolicy,
          method: "get_spending_limit_data",
          args: [xdr.ScVal.scvU32(contextRuleId), Address.fromString(treasury).toScVal()],
        }),
        readContractValue({
          rpcUrl, networkPassphrase, transactionSource: source.publicKey(), contractId: deployment.recipientPolicy,
          method: "get_config",
          args: [xdr.ScVal.scvU32(contextRuleId), Address.fromString(treasury).toScVal()],
        }),
      ]);
      const ruleData = rule as Record<string, unknown>;
      const spendingData = spending as Record<string, unknown>;
      const recipientData = recipient as Record<string, unknown>;
      const timestamp = new Date().toISOString();
      const delegatedSigner = findAddress(ruleData.signers, "G");
      const allowedRecipient = findAddress(recipientData.recipient, "G");
      if (!delegatedSigner || !allowedRecipient) continue;
      store.putAllowance({
        allowanceId: String(contextRuleId),
        label: typeof ruleData.name === "string" ? ruleData.name : `On-chain allowance ${contextRuleId}`,
        network: "stellar:testnet",
        treasuryContract: treasury,
        assetContract: deployment.token,
        delegatedSigner,
        maxSpendAtomic: String(spendingData.spending_limit),
        spentAtomic: String(spendingData.cached_total_spent ?? 0),
        windowLedgers: Number(spendingData.period_ledgers),
        allowedRecipients: [allowedRecipient],
        validUntilLedger: Number(ruleData.valid_until),
        contextRuleId,
        status: "ACTIVE",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } catch {
      // Removed rules leave gaps in the monotonically increasing rule index.
    }
  }
}

async function createOwnerScope(owner: string): Promise<OwnerConsoleScope> {
  const treasury = ownerTreasury(owner);
  if (!await treasuryExists(rpcUrl, treasury)) throw new Error("OWNER_TREASURY_NOT_ONBOARDED");
  const store = new SqliteEvidenceStore(path.join(ownerDatabaseDirectory, `owner-${treasury}.db`));
  await hydrateOwnerStore(treasury, store);
  const agentAllowance = makeAgentAllowance({ treasury, adminAddress: owner, store });
  const adminConfig: AdminConfig = {
    rpcUrl,
    horizonUrl,
    networkPassphrase,
    treasuryContract: treasury,
    assetContract: deployment.token,
    spendingPolicy: deployment.spendingPolicy,
    recipientPolicy: deployment.recipientPolicy,
    adminAddress: owner,
    transactionSource: source,
  };
  const walletAdmin: OwnerConsoleScope["walletAdmin"] = {
    prepareCreate: async (input) => {
      if (!input.label.trim() || input.allowedRecipients.length !== 1) throw new Error("One label and recipient are required");
      if (!delegatedSigners[input.delegatedSigner]) throw new Error("Delegated signer is not configured");
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
      pendingAdminOperations.put(operationId, {
        owner, kind: "create", prepared, expiresAt: Date.now() + 60_000,
        input: { ...input, windowLedgers, validUntilLedger },
      });
      return { operationId, authPreimageXdr: prepared.adminAuthPreimageXdr };
    },
    submitCreate: async (operationId, walletSignature) => {
      const pending = takePending(operationId, "create", owner);
      const result = await serializeSource(() => submitWalletAdminCall(adminConfig, pending.prepared, walletSignature));
      const context = result.retval as { id?: unknown };
      if (!Number.isInteger(context.id) || !pending.input) throw new Error("Created rule did not return a context rule ID");
      const timestamp = new Date().toISOString();
      const record: AllowanceRecord = {
        allowanceId: String(context.id), label: pending.input.label, network: "stellar:testnet",
        treasuryContract: treasury, assetContract: deployment.token,
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
      if (!record || record.treasuryContract !== treasury) throw new Error("Allowance not found for this wallet");
      const prepared = await prepareRevokeContextRuleAuthorization(adminConfig, record.contextRuleId);
      const operationId = randomUUID();
      pendingAdminOperations.put(operationId, {
        owner, kind: "revoke", prepared, allowanceId, expiresAt: Date.now() + 60_000,
      });
      return { operationId, authPreimageXdr: prepared.adminAuthPreimageXdr };
    },
    submitRevoke: async (operationId, walletSignature) => {
      const pending = takePending(operationId, "revoke", owner);
      const record = pending.allowanceId ? store.getAllowance(pending.allowanceId) : undefined;
      if (!record || record.treasuryContract !== treasury) throw new Error("Allowance not found for this wallet");
      const result = await serializeSource(() => submitWalletAdminCall(adminConfig, pending.prepared, walletSignature));
      const updated: AllowanceRecord = {
        ...record, status: "REVOKED", revokeTxHash: result.transactionHash, updatedAt: new Date().toISOString(),
      };
      store.putAllowance(updated);
      return updated;
    },
  };
  return {
    agentAllowance,
    deployment: {
      admin: owner,
      token: deployment.token,
      assetCode: deployment.assetCode,
      assetDecimals: deployment.assetDecimals,
      smartAccount: treasury,
      merchant: deployment.merchant,
    },
    walletAdmin,
  };
}

function ownerScope(owner: string): Promise<OwnerConsoleScope> {
  const cached = ownerScopes.get(owner);
  if (cached) return cached;
  const created = createOwnerScope(owner).catch((error) => {
    ownerScopes.delete(owner);
    throw error;
  });
  ownerScopes.set(owner, created);
  return created;
}

async function ownerProfile(owner: string): Promise<OwnerProfile> {
  const cached = ownerProfiles.get(owner);
  const treasury = ownerTreasury(owner);
  const onboarded = await treasuryExists(rpcUrl, treasury);
  if (!onboarded || cached) return {
    address: owner,
    treasury,
    onboarded,
    deploymentTransaction: cached?.deploymentTransaction,
    fundingTransaction: cached?.fundingTransaction,
    fundingError: cached?.fundingError,
  };
  let fundingTransaction: string | undefined;
  let fundingError: string | undefined;
  try {
    fundingTransaction = await ensureOwnerTreasuryFunding(treasury);
  } catch (error) {
    fundingError = error instanceof Error ? error.message : "Sponsored Testnet funding failed";
  }
  const profile: OwnerProfile = {
    address: owner,
    treasury,
    onboarded: true,
    fundingTransaction,
    fundingError,
  };
  if (!fundingError) ownerProfiles.set(owner, profile);
  return profile;
}

async function onboardOwner(owner: string): Promise<OwnerProfile> {
  const existing = await ownerProfile(owner);
  if (existing.onboarded) return existing;
  const latest = Number((await rpcServer.getLatestLedger()).sequence);
  const validUntilLedger = latest + ownerLifetimeLedgers;
  const result = await serializeSource(() => deployDeterministicTreasury(owner, ownerDeploymentConfig(validUntilLedger)));
  let fundingTransaction: string | undefined;
  let fundingError: string | undefined;
  if (ownerFundingTarget > 0n) {
    try {
      fundingTransaction = await ensureOwnerTreasuryFunding(result.treasuryContract);
    } catch (error) {
      fundingError = error instanceof Error ? error.message : "Sponsored Testnet funding failed";
    }
  }
  const profile: OwnerProfile = {
    address: owner,
    treasury: result.treasuryContract,
    onboarded: true,
    deploymentTransaction: result.transactionHash,
    fundingTransaction,
    fundingError,
  };
  ownerProfiles.set(owner, profile);
  if (result.created) {
    const store = new SqliteEvidenceStore(path.join(ownerDatabaseDirectory, `owner-${result.treasuryContract}.db`));
    putInitialRecord(store, {
      treasury: result.treasuryContract,
      delegate: ownerDelegate,
      validUntil: validUntilLedger,
      spendingLimit: ownerInitialLimit.toString(),
      periodLedgers: ownerPeriodLedgers,
      merchant: deployment.merchant,
      transactionHash: result.transactionHash,
    });
  }
  ownerScopes.delete(owner);
  return profile;
}

const app = createConsoleApp({
  agentAllowance: publicAgentAllowance,
  deployment,
  facilitatorUrl: configuredFacilitatorUrl,
  availableSigners: delegates.map((delegate) => delegate.publicKey()),
  demoServiceUrl,
  getLatestLedger: async () => Number((await rpcServer.getLatestLedger()).sequence),
  publicDemo: {
    allowanceId: process.env.PUBLIC_DEMO_ALLOWANCE_ID?.trim() ||
      (deployment.allowanceRuleId ? String(deployment.allowanceRuleId) : undefined),
    successCooldownMs: Number(process.env.PUBLIC_DEMO_SUCCESS_COOLDOWN_MS ?? "3600000"),
  },
  ownerService: {
    profile: ownerProfile,
    onboard: onboardOwner,
    scope: ownerScope,
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
