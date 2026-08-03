import type { PolicyReason } from "./reason-codes.js";

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";
export type AllowanceStatus = "DRAFT" | "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "REVOKED" | "ERROR";
export type AttemptState =
  | "CREATED"
  | "VALIDATED"
  | "SIGNED"
  | "SUBMITTED"
  | "SETTLED"
  | "UNLOCKED"
  | "BLOCKED"
  | "FAILED"
  | "UNKNOWN";

export type AllowanceRecord = {
  allowanceId: string;
  label: string;
  network: StellarNetwork;
  treasuryContract: string;
  assetContract: string;
  delegatedSigner: string;
  maxSpendAtomic: string;
  spentAtomic: string;
  windowLedgers: number;
  allowedRecipients: string[];
  validUntilLedger: number;
  contextRuleId: number;
  createTxHash?: string;
  revokeTxHash?: string;
  status: AllowanceStatus;
  createdAt: string;
  updatedAt: string;
};

export type PaymentAttempt = {
  attemptId: string;
  allowanceId: string;
  url: string;
  requestReference: string;
  challengeHash: string;
  amountAtomic: string;
  payTo: string;
  assetContract: string;
  state: AttemptState;
  decision: "ALLOW" | "BLOCK" | "PENDING" | "ERROR";
  reasonCode?: PolicyReason;
  safeDetail?: string;
  facilitatorStatus?: string;
  txHash?: string;
  receiptHash?: string;
  receipt?: SettlementReceipt;
  responseHash?: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRequirements = {
  scheme: "exact";
  network: StellarNetwork;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { areFeesSponsored: true; challengeId?: string; [key: string]: unknown };
};

export type PaymentRequired = {
  x402Version: 2;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
  error?: string;
};

export type StellarPaymentPayload = {
  x402Version: 2;
  accepted: PaymentRequirements;
  payload: { transaction: string };
};

export type SettlementReceipt = {
  success: true;
  transaction: string;
  network: StellarNetwork;
  payer: string;
  amount: string;
  asset: string;
  payTo: string;
  challengeId: string;
};

export type PolicyDecision =
  | { allowed: true; remainingAtomic: string }
  | { allowed: false; reason: PolicyReason; detail: string };
