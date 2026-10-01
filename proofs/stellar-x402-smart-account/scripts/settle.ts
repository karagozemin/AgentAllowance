import { readFile } from "node:fs/promises";
import path from "node:path";
import { API_KEY, FACILITATOR_URL } from "./lib/config.js";
import { latestDirectory, readJson, writeJson, writeText } from "./lib/artifacts.js";
import { readState } from "./lib/state.js";

if (!API_KEY) throw new Error("OZ_X402_API_KEY is required; copy .env.example to .env.local");
const classification = await readJson<{ classification: string }>("classification.json");
if (classification.classification !== "success") {
  console.log(`Settlement not called: /verify classification is ${classification.classification}.`);
  process.exit(0);
}
const directory = await latestDirectory();
const deployment = await readJson<any>("deployment.json");
const request = JSON.parse(
  await readFile(path.join(directory, "x402-payment-payload.json"), "utf8"),
);
const response = await fetch(`${FACILITATOR_URL.replace(/\/$/, "")}/settle`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
});
const rawBody = await response.text();
let body: unknown;
try {
  body = JSON.parse(rawBody);
} catch {
  body = { raw: rawBody };
}
await writeJson(directory, "settle-response.json", {
  requestedAt: new Date().toISOString(),
  httpStatus: response.status,
  body,
});
await writeText(directory, "settle-response-body.txt", rawBody);
await writeJson(directory, "state-after.json", readState(deployment));
console.log(JSON.stringify({ httpStatus: response.status, body }, null, 2));

