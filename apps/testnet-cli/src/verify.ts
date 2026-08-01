import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  FACILITATOR_API_KEY,
  FACILITATOR_URL,
  MAX_TIMEOUT_SECONDS,
  NETWORK,
} from "./config.js";
import { latestRunDirectory, readRunJson, writeJson, writeText } from "./runtime.js";

if (!FACILITATOR_URL) throw new Error("X402_FACILITATOR_URL is required");
type Deployment = { paymentAmount: string; merchant: string; token: string; smartAccount: string };
const deployment = await readRunJson<Deployment>("deployment.json");
const directory = await latestRunDirectory();
const transaction = (await readFile(path.join(directory, "transaction.xdr"), "utf8")).trim();
const paymentRequirements = {
  scheme: "exact" as const,
  network: NETWORK,
  amount: deployment.paymentAmount,
  payTo: deployment.merchant,
  maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
  asset: deployment.token,
  extra: { areFeesSponsored: true },
};
const request = {
  paymentPayload: { x402Version: 2, accepted: paymentRequirements, payload: { transaction } },
  paymentRequirements,
};
await writeJson(directory, "x402-payment-payload.json", request);
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (FACILITATOR_API_KEY) headers.Authorization = `Bearer ${FACILITATOR_API_KEY}`;
const response = await fetch(`${FACILITATOR_URL.replace(/\/$/, "")}/verify`, {
  method: "POST",
  headers,
  body: JSON.stringify(request),
});
const raw = await response.text();
let body: Record<string, unknown>;
try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = { raw }; }
await writeJson(directory, "verify-response.json", {
  requestedAt: new Date().toISOString(),
  httpStatus: response.status,
  body,
});
await writeText(directory, "verify-response-body.txt", raw);
const invalidReason = String(body.invalidReason ?? body.errorReason ?? "");
const classification = body.isValid === true
  ? "success"
  : invalidReason.includes("missing_payer_auth")
    ? "missing_payer_auth"
    : invalidReason.includes("has_subinvocations")
      ? "has_subinvocations"
      : invalidReason.includes("event_not_transfer")
        ? "event_not_transfer"
        : invalidReason.includes("policy_event_unapproved")
          ? "policy_event_unapproved"
          : invalidReason.includes("policy_event_malformed")
            ? "policy_event_malformed"
            : invalidReason.includes("auth_structure")
              ? "auth_structure_invalid"
              : "another_error";
await writeJson(directory, "classification.json", {
  classification,
  invalidReason: invalidReason || null,
});
console.log(JSON.stringify({ httpStatus: response.status, body, classification }, null, 2));
