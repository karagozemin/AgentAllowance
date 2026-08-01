import { readFile } from "node:fs/promises";
import path from "node:path";
import { Address, scValToNative, StrKey, xdr } from "@stellar/stellar-sdk";
import { latestDirectory, readJson, writeJson } from "./lib/artifacts.js";

function normalize(value: unknown): unknown {
  if (value instanceof Address) return value.toString();
  if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [String(key), normalize(item)]));
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

const directory = await latestDirectory();
const deployment = await readJson<any>("deployment.json");
const simulation = JSON.parse(
  await readFile(path.join(directory, "simulation-enforce-response.json"), "utf8"),
);
const decoded = (simulation.events ?? []).map((encoded: string, index: number) => {
  const diagnostic = xdr.DiagnosticEvent.fromXDR(encoded, "base64");
  const event = diagnostic.event();
  const body = event.body().v0();
  const contractId = event.contractId()
    ? StrKey.encodeContract(Buffer.from(event.contractId() as unknown as Uint8Array))
    : null;
  return {
    index,
    xdr: encoded,
    inSuccessfulContractCall: diagnostic.inSuccessfulContractCall(),
    type: event.type().name,
    contractId,
    topics: body.topics().map((topic) => normalize(scValToNative(topic))),
    data: normalize(scValToNative(body.data())),
  };
});
const policyEvent = decoded.find(
  (event: any) =>
    event.contractId === deployment.policy && event.topics[0] === "spending_limit_enforced",
);
await writeJson(directory, "events-decoded.json", decoded);
await writeJson(directory, "rejected-policy-event.json", policyEvent ?? null);
console.log(
  JSON.stringify(
    { eventCount: decoded.length, policyEvent },
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
