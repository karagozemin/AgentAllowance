import { createHash } from "node:crypto";
import type {
  PaymentRequired,
  PaymentRequirements,
  SettlementReceipt,
  StellarPaymentPayload,
  StellarNetwork,
} from "./types.js";
import { parseAtomicAmount } from "./amounts.js";

const CONTRACT = /^C[A-Z2-7]{55}$/;
const ACCOUNT = /^[CG][A-Z2-7]{55}$/;

export function parsePaymentRequired(value: unknown): PaymentRequired {
  if (!value || typeof value !== "object") throw new Error("Payment challenge must be an object");
  const challenge = value as Partial<PaymentRequired>;
  if (challenge.x402Version !== 2 || !challenge.resource || !Array.isArray(challenge.accepts)) {
    throw new Error("Unsupported or malformed x402 challenge");
  }
  if (challenge.accepts.length !== 1) throw new Error("MVP requires exactly one payment option");
  const accepted = challenge.accepts[0] as Partial<PaymentRequirements> | undefined;
  if (
    !accepted ||
    accepted.scheme !== "exact" ||
    !["stellar:testnet", "stellar:pubnet"].includes(accepted.network ?? "") ||
    !CONTRACT.test(accepted.asset ?? "") ||
    !ACCOUNT.test(accepted.payTo ?? "") ||
    !Number.isInteger(accepted.maxTimeoutSeconds) ||
    accepted.maxTimeoutSeconds! <= 0 ||
    accepted.extra?.areFeesSponsored !== true
  ) {
    throw new Error("Unsupported Stellar exact payment requirements");
  }
  parseAtomicAmount(accepted.amount ?? "");
  return challenge as PaymentRequired;
}

export function selectExactPayment(
  challenge: PaymentRequired,
  network: StellarNetwork,
): PaymentRequirements {
  const accepted = challenge.accepts.find((candidate) => candidate.network === network);
  if (!accepted) throw new Error(`Challenge does not support ${network}`);
  return accepted;
}

export function encodePaymentSignature(payload: StellarPaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodePaymentSignature(value: string): StellarPaymentPayload {
  const decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as StellarPaymentPayload;
  if (decoded.x402Version !== 2 || !decoded.accepted || !decoded.payload?.transaction) {
    throw new Error("Malformed PAYMENT-SIGNATURE payload");
  }
  return decoded;
}

export function encodePaymentResponse(receipt: SettlementReceipt): string {
  return Buffer.from(JSON.stringify(receipt)).toString("base64");
}

export function decodePaymentResponse(value: string): SettlementReceipt {
  const receipt = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as SettlementReceipt;
  if (receipt.success !== true || !receipt.transaction || !receipt.payer) {
    throw new Error("Malformed PAYMENT-RESPONSE receipt");
  }
  return receipt;
}

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
