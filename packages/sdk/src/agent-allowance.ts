import { randomUUID } from "node:crypto";
import {
  Address,
  Keypair,
  Networks,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  decodePaymentResponse,
  encodePaymentSignature,
  parseAtomicAmount,
  parsePaymentRequired,
  selectExactPayment,
  stableHash,
  type AllowanceRecord,
  type PaymentAttempt,
  type PaymentRequired,
  type PaymentRequirements,
  type PolicyDecision,
  type SettlementReceipt,
  type StellarNetwork,
} from "@agentallowance/shared";
import {
  FacilitatorClient,
  assertReceiptMatches,
  buildSmartAccountPayment,
} from "@agentallowance/x402-payer";
import { AgentAllowanceError } from "./errors.js";
import { SqliteEvidenceStore, type EvidenceStore } from "./store.js";
import {
  createContextRule,
  readContractValue,
  revokeContextRule,
  type AdminConfig,
} from "./stellar-admin.js";

export type AllowanceCreateInput = {
  label: string;
  delegatedSigner: string;
  maxSpendAtomic: string;
  windowSeconds: number;
  allowedRecipients: string[];
  expiresInSeconds: number;
};

export type AgentAllowanceConfig = {
  network: StellarNetwork;
  rpcUrl: string;
  horizonUrl?: string;
  assetContract: string;
  treasuryContract: string;
  spendingPolicy: string;
  recipientPolicy: string;
  facilitatorUrl: string;
  facilitatorApiKey?: string;
  transactionSource: Keypair;
  adminSigner: Keypair;
  delegatedSigners: Record<string, Keypair>;
  databasePath?: string;
  store?: EvidenceStore;
};

function now(): string {
  return new Date().toISOString();
}

function assertAddress(value: string): void {
  try { Address.fromString(value); } catch { throw new AgentAllowanceError("CONFIGURATION_ERROR", { detail: value }); }
}

function withUpdate(record: PaymentAttempt, update: Partial<PaymentAttempt>): PaymentAttempt {
  return { ...record, ...update, updatedAt: now() };
}

export class AgentAllowance {
  readonly #config: AgentAllowanceConfig;
  readonly #store: EvidenceStore;
  readonly #facilitator: FacilitatorClient;
  readonly #networkPassphrase: string;

  readonly allowances: {
    create: (input: AllowanceCreateInput) => Promise<AllowanceRecord>;
    get: (id: string) => Promise<AllowanceRecord>;
    list: () => Promise<AllowanceRecord[]>;
    revoke: (id: string) => Promise<AllowanceRecord>;
  };
  readonly treasury: { balance: () => Promise<string> };

  constructor(config: AgentAllowanceConfig) {
    this.#config = config;
    this.#store = config.store ?? new SqliteEvidenceStore(config.databasePath ?? "./data/agentallowance.db");
    this.#facilitator = new FacilitatorClient(config.facilitatorUrl, config.facilitatorApiKey);
    this.#networkPassphrase = config.network === "stellar:pubnet" ? Networks.PUBLIC : Networks.TESTNET;
    for (const value of [
      config.assetContract,
      config.treasuryContract,
      config.spendingPolicy,
      config.recipientPolicy,
      config.transactionSource.publicKey(),
      config.adminSigner.publicKey(),
    ]) assertAddress(value);

    this.allowances = {
      create: (input) => this.#createAllowance(input),
      get: (id) => this.#getAllowance(id),
      list: () => this.#listAllowances(),
      revoke: (id) => this.#revokeAllowance(id),
    };
    this.treasury = { balance: () => this.#treasuryBalance() };
  }

  getAttempt(attemptId: string): PaymentAttempt {
    const attempt = this.#store.getAttempt(attemptId);
    if (!attempt) throw new AgentAllowanceError("ALLOWANCE_NOT_FOUND", { attemptId });
    return attempt;
  }

  listAttempts(limit = 100): PaymentAttempt[] {
    return this.#store.listAttempts(limit);
  }

  preflight(requirements: PaymentRequirements, allowance: AllowanceRecord, currentLedger: number): PolicyDecision {
    if (requirements.network !== allowance.network) {
      return { allowed: false, reason: "NETWORK_MISMATCH", detail: "Network differs from allowance" };
    }
    if (requirements.asset !== allowance.assetContract) {
      return { allowed: false, reason: "ASSET_NOT_ALLOWED", detail: "Asset differs from allowance" };
    }
    if (!allowance.allowedRecipients.includes(requirements.payTo)) {
      return { allowed: false, reason: "RECIPIENT_NOT_ALLOWED", detail: "Recipient is not in the on-chain policy" };
    }
    if (allowance.status === "REVOKED") {
      return { allowed: false, reason: "ALLOWANCE_REVOKED", detail: "Context rule was removed" };
    }
    if (allowance.validUntilLedger < currentLedger || allowance.status === "EXPIRED") {
      return { allowed: false, reason: "ALLOWANCE_EXPIRED", detail: "valid_until is behind current ledger" };
    }
    if (allowance.status !== "ACTIVE") {
      return { allowed: false, reason: "ALLOWANCE_NOT_ACTIVE", detail: `Allowance status is ${allowance.status}` };
    }
    const amount = parseAtomicAmount(requirements.amount);
    const remaining = BigInt(allowance.maxSpendAtomic) - BigInt(allowance.spentAtomic);
    if (amount > remaining) {
      return { allowed: false, reason: "BUDGET_EXCEEDED", detail: `${amount} exceeds ${remaining}` };
    }
    return { allowed: true, remainingAtomic: (remaining - amount).toString() };
  }

  async pay(
    challenge: PaymentRequired,
    options: { allowanceId: string; url?: string; signal?: AbortSignal },
  ): Promise<SettlementReceipt> {
    const requirements = selectExactPayment(challenge, this.#config.network);
    const attempt = await this.#reserveAttempt(options.allowanceId, options.url ?? challenge.resource.url, requirements);
    const { paymentPayload, allowance } = await this.#authorizeAttempt(attempt, requirements);
    const verified = await this.#facilitator.verify(paymentPayload, requirements, options.signal);
    if (!verified.isValid) {
      this.#failAttempt(attempt, "FACILITATOR_REJECTED", verified.invalidReason ?? "verify rejected");
    }
    const submitted = withUpdate(attempt, { state: "SUBMITTED", decision: "PENDING", facilitatorStatus: "verified" });
    this.#store.putAttempt(submitted);
    try {
      const receipt = await this.#facilitator.settle(paymentPayload, requirements, options.signal);
      assertReceiptMatches(receipt, requirements, allowance.treasuryContract);
      this.#store.putAttempt(withUpdate(submitted, {
        state: "SETTLED",
        decision: "ALLOW",
        facilitatorStatus: "settled",
        txHash: receipt.transaction,
        receipt,
        receiptHash: stableHash(JSON.stringify(receipt)),
      }));
      return receipt;
    } catch (error) {
      this.#store.putAttempt(withUpdate(submitted, {
        state: "UNKNOWN",
        decision: "PENDING",
        reasonCode: "SETTLEMENT_UNKNOWN",
        safeDetail: error instanceof Error ? error.message : "Unknown settlement error",
      }));
      throw new AgentAllowanceError("SETTLEMENT_UNKNOWN", { attemptId: attempt.attemptId, cause: error });
    }
  }

  async fetch(
    url: string,
    options: { allowanceId: string; request?: RequestInit; signal?: AbortSignal },
  ): Promise<Response> {
    const first = await fetch(url, { ...options.request, signal: options.signal });
    if (first.status !== 402) return first;
    const challenge = parsePaymentRequired(await first.json());
    const requirements = selectExactPayment(challenge, this.#config.network);
    const attempt = await this.#reserveAttempt(options.allowanceId, url, requirements);
    const { paymentPayload, allowance } = await this.#authorizeAttempt(attempt, requirements);
    const verified = await this.#facilitator.verify(paymentPayload, requirements, options.signal);
    if (!verified.isValid) {
      this.#failAttempt(attempt, "FACILITATOR_REJECTED", verified.invalidReason ?? "verify rejected");
    }
    this.#store.putAttempt(withUpdate(attempt, {
      state: "SUBMITTED",
      decision: "PENDING",
      facilitatorStatus: "verified",
    }));

    let unlocked: Response;
    try {
      const headers = new Headers(options.request?.headers);
      headers.set("PAYMENT-SIGNATURE", encodePaymentSignature(paymentPayload));
      unlocked = await fetch(url, { ...options.request, headers, signal: options.signal });
    } catch (error) {
      this.#store.putAttempt(withUpdate(attempt, {
        state: "UNKNOWN",
        decision: "PENDING",
        reasonCode: "SETTLEMENT_UNKNOWN",
        safeDetail: error instanceof Error ? error.message : "Paid request failed",
      }));
      throw new AgentAllowanceError("SETTLEMENT_UNKNOWN", { attemptId: attempt.attemptId, cause: error });
    }

    const encodedReceipt = unlocked.headers.get("PAYMENT-RESPONSE");
    if (!encodedReceipt) {
      this.#failAttempt(attempt, "RESOURCE_UNLOCK_FAILED", `Paid request returned HTTP ${unlocked.status}`);
    }
    const receipt = decodePaymentResponse(encodedReceipt);
    try {
      assertReceiptMatches(receipt, requirements, allowance.treasuryContract);
    } catch (error) {
      this.#failAttempt(attempt, "RECEIPT_MISMATCH", error instanceof Error ? error.message : "Receipt mismatch");
    }
    const body = await unlocked.clone().text();
    this.#store.putAttempt(withUpdate(attempt, {
      state: unlocked.ok ? "UNLOCKED" : "SETTLED",
      decision: unlocked.ok ? "ALLOW" : "ERROR",
      reasonCode: unlocked.ok ? undefined : "RESOURCE_UNLOCK_FAILED",
      facilitatorStatus: "settled",
      txHash: receipt.transaction,
      receipt,
      receiptHash: stableHash(JSON.stringify(receipt)),
      responseHash: unlocked.ok ? stableHash(body) : undefined,
    }));
    if (!unlocked.ok) throw new AgentAllowanceError("RESOURCE_UNLOCK_FAILED", { attemptId: attempt.attemptId });
    return unlocked;
  }

  async reconcile(attemptId: string): Promise<PaymentAttempt> {
    const attempt = this.getAttempt(attemptId);
    if (attempt.state !== "UNKNOWN" && attempt.state !== "SUBMITTED") return attempt;
    const challengeId = attempt.requestReference;
    try {
      const statusUrl = new URL(`/payments/${encodeURIComponent(challengeId)}`, attempt.url);
      const response = await fetch(statusUrl);
      if (!response.ok) return attempt;
      const receipt = await response.json() as SettlementReceipt;
      if (!receipt.success) return attempt;
      const updated = withUpdate(attempt, {
        state: "SETTLED",
        decision: "ALLOW",
        facilitatorStatus: "settled",
        txHash: receipt.transaction,
        receipt,
        receiptHash: stableHash(JSON.stringify(receipt)),
        reasonCode: undefined,
      });
      this.#store.putAttempt(updated);
      return updated;
    } catch {
      return attempt;
    }
  }

  async #createAllowance(input: AllowanceCreateInput): Promise<AllowanceRecord> {
    if (!input.label.trim() || input.allowedRecipients.length !== 1) {
      throw new AgentAllowanceError("CONFIGURATION_ERROR", { detail: "MVP requires a label and one recipient" });
    }
    assertAddress(input.delegatedSigner);
    assertAddress(input.allowedRecipients[0]!);
    const signer = this.#config.delegatedSigners[input.delegatedSigner];
    if (!signer || signer.publicKey() !== input.delegatedSigner) {
      throw new AgentAllowanceError("SIGNER_NOT_AUTHORIZED", { detail: "Signer process is not configured" });
    }
    const maxSpend = parseAtomicAmount(input.maxSpendAtomic);
    if (!Number.isFinite(input.windowSeconds) || input.windowSeconds < 5) {
      throw new AgentAllowanceError("CONFIGURATION_ERROR", { detail: "Invalid rolling window" });
    }
    if (!Number.isFinite(input.expiresInSeconds) || input.expiresInSeconds < 10) {
      throw new AgentAllowanceError("CONFIGURATION_ERROR", { detail: "Invalid expiry" });
    }
    const latest = await new rpc.Server(this.#config.rpcUrl).getLatestLedger();
    const windowLedgers = Math.ceil(input.windowSeconds / 5);
    const validUntilLedger = Number(latest.sequence) + Math.ceil(input.expiresInSeconds / 5);
    const created = await createContextRule(this.#adminConfig(), {
      label: input.label,
      delegatedSigner: input.delegatedSigner,
      maxSpendAtomic: maxSpend,
      windowLedgers,
      recipient: input.allowedRecipients[0]!,
      validUntilLedger,
    });
    const timestamp = now();
    const record: AllowanceRecord = {
      allowanceId: String(created.contextRuleId),
      label: input.label,
      network: this.#config.network,
      treasuryContract: this.#config.treasuryContract,
      assetContract: this.#config.assetContract,
      delegatedSigner: input.delegatedSigner,
      maxSpendAtomic: maxSpend.toString(),
      spentAtomic: "0",
      windowLedgers,
      allowedRecipients: [...input.allowedRecipients],
      validUntilLedger,
      contextRuleId: created.contextRuleId,
      createTxHash: created.transactionHash,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#store.putAllowance(record);
    return record;
  }

  async #getAllowance(id: string): Promise<AllowanceRecord> {
    const record = this.#store.getAllowance(id);
    if (!record) throw new AgentAllowanceError("ALLOWANCE_NOT_FOUND", { detail: id });
    if (record.status === "REVOKED") return record;
    try {
      const [latest, spending] = await Promise.all([
        new rpc.Server(this.#config.rpcUrl).getLatestLedger(),
        readContractValue({
          rpcUrl: this.#config.rpcUrl,
          networkPassphrase: this.#networkPassphrase,
          transactionSource: this.#config.transactionSource.publicKey(),
          contractId: this.#config.spendingPolicy,
          method: "get_spending_limit_data",
          args: [xdr.ScVal.scvU32(record.contextRuleId), Address.fromString(record.treasuryContract).toScVal()],
        }),
      ]);
      const data = spending as { cached_total_spent?: bigint | number | string };
      const spentAtomic = String(data.cached_total_spent ?? record.spentAtomic);
      const status = record.validUntilLedger < Number(latest.sequence)
        ? "EXPIRED"
        : BigInt(spentAtomic) >= BigInt(record.maxSpendAtomic)
          ? "EXHAUSTED"
          : "ACTIVE";
      const updated: AllowanceRecord = { ...record, spentAtomic, status, updatedAt: now() };
      this.#store.putAllowance(updated);
      return updated;
    } catch {
      const updated: AllowanceRecord = { ...record, status: "ERROR", updatedAt: now() };
      this.#store.putAllowance(updated);
      return updated;
    }
  }

  async #listAllowances(): Promise<AllowanceRecord[]> {
    return Promise.all(this.#store.listAllowances().map((record) => this.#getAllowance(record.allowanceId)));
  }

  async #revokeAllowance(id: string): Promise<AllowanceRecord> {
    const record = this.#store.getAllowance(id);
    if (!record) throw new AgentAllowanceError("ALLOWANCE_NOT_FOUND", { detail: id });
    if (record.status === "REVOKED") return record;
    const revokeTxHash = await revokeContextRule(this.#adminConfig(), record.contextRuleId);
    const updated: AllowanceRecord = { ...record, status: "REVOKED", revokeTxHash, updatedAt: now() };
    this.#store.putAllowance(updated);
    return updated;
  }

  async #treasuryBalance(): Promise<string> {
    const value = await readContractValue({
      rpcUrl: this.#config.rpcUrl,
      networkPassphrase: this.#networkPassphrase,
      transactionSource: this.#config.transactionSource.publicKey(),
      contractId: this.#config.assetContract,
      method: "balance",
      args: [Address.fromString(this.#config.treasuryContract).toScVal()],
    });
    return String(value);
  }

  async #reserveAttempt(
    allowanceId: string,
    url: string,
    requirements: PaymentRequirements,
  ): Promise<PaymentAttempt> {
    const requestReference = String(requirements.extra.challengeId ?? stableHash(JSON.stringify(requirements)));
    const existing = this.#store.findAttempt(allowanceId, requestReference);
    if (existing) throw new AgentAllowanceError("DUPLICATE_ATTEMPT", { attemptId: existing.attemptId });
    const timestamp = now();
    const attempt: PaymentAttempt = {
      attemptId: randomUUID(),
      allowanceId,
      url,
      requestReference,
      challengeHash: stableHash(JSON.stringify(requirements)),
      amountAtomic: requirements.amount,
      payTo: requirements.payTo,
      assetContract: requirements.asset,
      state: "CREATED",
      decision: "PENDING",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#store.putAttempt(attempt);
    return attempt;
  }

  async #authorizeAttempt(
    attempt: PaymentAttempt,
    requirements: PaymentRequirements,
  ): Promise<{ paymentPayload: Awaited<ReturnType<typeof buildSmartAccountPayment>>["paymentPayload"]; allowance: AllowanceRecord }> {
    const allowance = await this.#getAllowance(attempt.allowanceId);
    const latest = await new rpc.Server(this.#config.rpcUrl).getLatestLedger();
    const decision = this.preflight(requirements, allowance, Number(latest.sequence));
    if (!decision.allowed) this.#failAttempt(attempt, decision.reason, decision.detail);
    this.#store.putAttempt(withUpdate(attempt, { state: "VALIDATED", decision: "ALLOW" }));
    const signer = this.#config.delegatedSigners[allowance.delegatedSigner];
    if (!signer) this.#failAttempt(attempt, "SIGNER_NOT_AUTHORIZED", "Signer process is unavailable");
    try {
      const built = await buildSmartAccountPayment({
        rpcUrl: this.#config.rpcUrl,
        networkPassphrase: this.#networkPassphrase,
        smartAccount: allowance.treasuryContract,
        delegatedSigner: signer,
        contextRuleId: allowance.contextRuleId,
        transactionSource: this.#config.transactionSource.publicKey(),
      }, requirements);
      this.#store.putAttempt(withUpdate(attempt, { state: "SIGNED", decision: "ALLOW" }));
      return { paymentPayload: built.paymentPayload, allowance };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authorization simulation failed";
      const reason = message.toLowerCase().includes("recipient")
        ? "RECIPIENT_NOT_ALLOWED"
        : message.toLowerCase().includes("limit") || message.toLowerCase().includes("budget")
          ? "BUDGET_EXCEEDED"
          : "FACILITATOR_REJECTED";
      this.#failAttempt(attempt, reason, message);
    }
  }

  #failAttempt(attempt: PaymentAttempt, reason: PaymentAttempt["reasonCode"] & string, detail: string): never {
    this.#store.putAttempt(withUpdate(attempt, {
      state: "BLOCKED",
      decision: "BLOCK",
      reasonCode: reason as PaymentAttempt["reasonCode"],
      safeDetail: detail,
    }));
    throw new AgentAllowanceError(reason as NonNullable<PaymentAttempt["reasonCode"]>, {
      attemptId: attempt.attemptId,
      detail,
    });
  }

  #adminConfig(): AdminConfig {
    return {
      rpcUrl: this.#config.rpcUrl,
      horizonUrl: this.#config.horizonUrl ?? (
        this.#config.network === "stellar:pubnet"
          ? "https://horizon.stellar.org"
          : "https://horizon-testnet.stellar.org"
      ),
      networkPassphrase: this.#networkPassphrase,
      treasuryContract: this.#config.treasuryContract,
      assetContract: this.#config.assetContract,
      spendingPolicy: this.#config.spendingPolicy,
      recipientPolicy: this.#config.recipientPolicy,
      adminSigner: this.#config.adminSigner,
      transactionSource: this.#config.transactionSource,
    };
  }
}
