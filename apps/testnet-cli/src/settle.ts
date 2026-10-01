import { readFile } from "node:fs/promises";
import path from "node:path";
import { FACILITATOR_API_KEY, FACILITATOR_URL } from "./config.js";
import { latestAttemptDirectory, readAttemptJson, writeJson, writeText } from "./runtime.js";

if (!FACILITATOR_URL) throw new Error("X402_FACILITATOR_URL is required");
const classification = await readAttemptJson<{ classification: string }>("classification.json");
if (classification.classification !== "success") {
  throw new Error(`Settlement blocked: verify classification is ${classification.classification}`);
}
if (process.env.ALLOW_SETTLEMENT !== "yes") {
  throw new Error("Settlement blocked: set ALLOW_SETTLEMENT=yes after reviewing verify-response.json");
}
const directory = await latestAttemptDirectory();
const request = await readFile(path.join(directory, "x402-payment-payload.json"), "utf8");
const headers: Record<string, string> = { "Content-Type": "application/json" };
if (FACILITATOR_API_KEY) headers.Authorization = `Bearer ${FACILITATOR_API_KEY}`;
const response = await fetch(`${FACILITATOR_URL.replace(/\/$/, "")}/settle`, {
  method: "POST",
  headers,
  body: request,
});
const raw = await response.text();
let body: unknown;
try { body = JSON.parse(raw); } catch { body = { raw }; }
await writeJson(directory, "settle-response.json", {
  requestedAt: new Date().toISOString(),
  httpStatus: response.status,
  body,
});
await writeText(directory, "settle-response-body.txt", raw);
console.log(JSON.stringify({ httpStatus: response.status, body }, null, 2));
