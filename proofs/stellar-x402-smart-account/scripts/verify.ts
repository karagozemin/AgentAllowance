import { readFile } from "node:fs/promises";
import path from "node:path";
import { API_KEY, FACILITATOR_URL, MAX_TIMEOUT_SECONDS, NETWORK } from "./lib/config.js";
import { latestDirectory, readJson, writeJson, writeText } from "./lib/artifacts.js";

if (!API_KEY) throw new Error("OZ_X402_API_KEY is required; copy .env.example to .env.local");
const deployment = await readJson<any>("deployment.json");
const directory = await latestDirectory();
const transaction = (await readFile(path.join(directory, "transaction.xdr"), "utf8")).trim();
const paymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  amount: deployment.paymentAmount,
  payTo: deployment.merchant,
  maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
  asset: deployment.token,
  extra: { areFeesSponsored: true },
};
const paymentPayload = {
  x402Version: 2,
  accepted: paymentRequirements,
  payload: { transaction },
};
const request = { paymentPayload, paymentRequirements };
await writeJson(directory, "x402-payment-payload.json", request);

const response = await fetch(`${FACILITATOR_URL.replace(/\/$/, "")}/verify`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
});
const rawBody = await response.text();
let body: any;
try {
  body = JSON.parse(rawBody);
} catch {
  body = { raw: rawBody };
}
const reason = String(body.invalidReason ?? body.errorReason ?? body.error ?? "");
const classification = body.isValid === true
  ? "success"
  : reason.includes("missing_payer_auth")
    ? "missing_payer_auth"
    : reason.includes("has_subinvocations")
      ? "has_subinvocations"
      : reason.includes("event_not_transfer")
        ? "event_not_transfer"
        : "another_error";
await writeJson(directory, "verify-response.json", {
  requestedAt: new Date().toISOString(),
  url: `${FACILITATOR_URL.replace(/\/$/, "")}/verify`,
  httpStatus: response.status,
  headers: Object.fromEntries(response.headers.entries()),
  body,
});
await writeText(directory, "verify-response-body.txt", rawBody);
await writeJson(directory, "classification.json", {
  classification,
  invalidReason: reason || null,
  httpStatus: response.status,
});
console.log(JSON.stringify({ httpStatus: response.status, body, classification }, null, 2));

