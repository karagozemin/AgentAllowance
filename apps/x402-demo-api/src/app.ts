import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { rpc } from "@stellar/stellar-sdk";
import {
  decodePaymentSignature,
  encodePaymentResponse,
  stableHash,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementReceipt,
} from "@agentallowance/shared";
import { FacilitatorClient, assertReceiptMatches } from "@agentallowance/x402-payer";
import { DemoPaymentStore } from "./store.js";

export type DemoApiConfig = {
  network: "stellar:testnet";
  rpcUrl: string;
  assetContract: string;
  treasuryContract: string;
  merchant: string;
  unapprovedRecipient: string;
  amountAtomic: string;
  overLimitAmountAtomic: string;
  facilitatorUrl: string;
  facilitatorApiKey?: string;
  publicBaseUrl: string;
  store: DemoPaymentStore;
  getLatestLedger?: () => Promise<number>;
};

function sameRequirements(left: PaymentRequirements, right: PaymentRequirements): boolean {
  return left.scheme === right.scheme &&
    left.network === right.network &&
    left.amount === right.amount &&
    left.payTo === right.payTo &&
    left.asset === right.asset &&
    left.maxTimeoutSeconds === right.maxTimeoutSeconds &&
    left.extra.challengeId === right.extra.challengeId &&
    left.extra.areFeesSponsored === right.extra.areFeesSponsored;
}

export function createApp(config: DemoApiConfig) {
  const app = new Hono();
  const facilitator = new FacilitatorClient(config.facilitatorUrl, config.facilitatorApiKey);
  app.use("*", cors({
    origin: "*",
    allowHeaders: ["Content-Type", "PAYMENT-SIGNATURE"],
    exposeHeaders: ["PAYMENT-RESPONSE"],
  }));

  app.get("/health", (context) => context.json({ status: "ok", network: config.network }));

  app.get("/premium", async (context) => {
    const paymentSignature = context.req.header("PAYMENT-SIGNATURE");
    if (!paymentSignature) {
      const scenario = context.req.query("scenario") ?? "success";
      const challengeId = randomUUID();
      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: config.network,
        amount: scenario === "over-limit" ? config.overLimitAmountAtomic : config.amountAtomic,
        payTo: scenario === "unapproved-recipient" ? config.unapprovedRecipient : config.merchant,
        maxTimeoutSeconds: 60,
        asset: config.assetContract,
        extra: { areFeesSponsored: true, challengeId },
      };
      config.store.create({ id: challengeId, requirements, expiresAt: Date.now() + 60_000 });
      const challenge: PaymentRequired = {
        x402Version: 2,
        resource: {
          url: `${config.publicBaseUrl}/premium`,
          description: "Current Stellar Testnet treasury and ledger summary",
          mimeType: "application/json",
        },
        accepts: [requirements],
      };
      return context.json(challenge, 402);
    }

    let payload;
    try {
      payload = decodePaymentSignature(paymentSignature);
    } catch {
      return context.json({ error: "MALFORMED_PAYMENT_SIGNATURE" }, 400);
    }
    const challengeId = String(payload.accepted.extra.challengeId ?? "");
    const challenge = config.store.get(challengeId);
    if (!challenge) return context.json({ error: "CHALLENGE_NOT_FOUND" }, 404);
    const payloadHash = stableHash(paymentSignature);
    if (challenge.expiresAt < Date.now()) return context.json({ error: "CHALLENGE_EXPIRED" }, 410);
    if (!sameRequirements(payload.accepted, challenge.requirements)) {
      return context.json({ error: "PAYMENT_REQUIREMENTS_MISMATCH" }, 400);
    }

    const claim = config.store.claim(challengeId, payloadHash);
    if (claim.status === "settled") return protectedResponse(context, config, claim.receipt);
    if (claim.status === "pending") return context.json({ error: "SETTLEMENT_PENDING", challengeId }, 202);
    if (claim.status === "conflict") return context.json({ error: "CHALLENGE_ALREADY_CLAIMED" }, 409);

    let verified;
    try {
      verified = await facilitator.verify(payload, challenge.requirements);
    } catch (error) {
      config.store.release(challengeId, payloadHash);
      return context.json({
        error: "FACILITATOR_UNAVAILABLE",
        detail: error instanceof Error ? error.message : "Facilitator verification failed",
      }, 502);
    }
    if (!verified.isValid || verified.payer !== config.treasuryContract) {
      config.store.release(challengeId, payloadHash);
      return context.json({
        error: "FACILITATOR_REJECTED",
        reason: verified.isValid ? "payer_mismatch" : verified.invalidReason,
      }, 402);
    }
    let receipt: SettlementReceipt;
    try {
      receipt = await facilitator.settle(payload, challenge.requirements);
      assertReceiptMatches(receipt, challenge.requirements, config.treasuryContract);
    } catch (error) {
      return context.json({
        error: "SETTLEMENT_FAILED",
        detail: error instanceof Error ? error.message : "Unknown settlement error",
      }, 502);
    }
    config.store.settle(challengeId, payloadHash, receipt);
    return protectedResponse(context, config, receipt);
  });

  app.get("/payments/:challengeId", (context) => {
    const challenge = config.store.get(context.req.param("challengeId"));
    if (!challenge) return context.json({ error: "NOT_FOUND" }, 404);
    if (!challenge.receipt) return context.json({ status: "PENDING" }, 202);
    return context.json(challenge.receipt);
  });

  async function protectedResponse(
    context: Context,
    currentConfig: DemoApiConfig,
    receipt: SettlementReceipt,
  ) {
    const latestLedger = currentConfig.getLatestLedger
      ? await currentConfig.getLatestLedger()
      : Number((await new rpc.Server(currentConfig.rpcUrl).getLatestLedger()).sequence);
    context.header("PAYMENT-RESPONSE", encodePaymentResponse(receipt));
    context.header("Cache-Control", "no-store");
    return context.json({
      access: "PAID_AND_UNLOCKED",
      network: currentConfig.network,
      latestLedger,
      treasury: currentConfig.treasuryContract,
      transaction: receipt.transaction,
      generatedAt: new Date().toISOString(),
    });
  }

  return app;
}
