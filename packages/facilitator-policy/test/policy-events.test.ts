import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { Address, Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import {
  OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
  validatePolicyAwareSimulationEvents,
  type FacilitatorPolicyManifest,
} from "../src/index.js";

const runDirectory = fileURLToPath(
  new URL("../../../test/fixtures/stellar-policy-payment/", import.meta.url),
);
const simulation = JSON.parse(
  readFileSync(`${runDirectory}/simulation-enforce-response.json`, "utf8"),
) as { events: string[] };
const deployment = JSON.parse(readFileSync(`${runDirectory}/deployment.json`, "utf8")) as {
  token: string;
  smartAccount: string;
  merchant: string;
  policy: string;
  ruleId: number;
  paymentAmount: string;
};

const expected = {
  token: deployment.token,
  from: deployment.smartAccount,
  to: deployment.merchant,
  amount: BigInt(deployment.paymentAmount),
  contextRuleId: deployment.ruleId,
};
const manifest: FacilitatorPolicyManifest = {
  id: "proof-openzeppelin-0.7.2",
  network: "stellar:testnet",
  smartAccount: deployment.smartAccount,
  expectedRuleId: deployment.ruleId,
  adapters: [
    {
      kind: OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
      contractId: deployment.policy,
      required: true,
    },
  ],
};

function contractEvents(events: string[]): string[] {
  return events.filter((raw) => xdr.DiagnosticEvent.fromXDR(raw, "base64").event().type().name === "contract");
}

function rebuildEvent(
  raw: string,
  options: { contractId?: Buffer; eventName?: string; data?: xdr.ScVal; successful?: boolean },
): string {
  const diagnostic = xdr.DiagnosticEvent.fromXDR(raw, "base64");
  const event = diagnostic.event();
  const oldBody = event.body().v0();
  const topics = [...oldBody.topics()];
  if (options.eventName !== undefined) topics[0] = xdr.ScVal.scvSymbol(options.eventName);
  const body = new xdr.ContractEventBody(
    0,
    new xdr.ContractEventV0({ topics, data: options.data ?? oldBody.data() }),
  );
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: options.successful ?? diagnostic.inSuccessfulContractCall(),
    event: new xdr.ContractEvent({
      ext: event.ext(),
      contractId: options.contractId ?? event.contractId(),
      type: event.type(),
      body,
    }),
  }).toXDR("base64");
}

function replacePolicyField(raw: string, field: string, value: xdr.ScVal): string {
  const diagnostic = xdr.DiagnosticEvent.fromXDR(raw, "base64");
  const data = diagnostic.event().body().v0().data();
  const entries = (data.map() ?? []).map((entry) =>
    entry.key().switch().name === "scvSymbol" && entry.key().sym().toString() === field
      ? new xdr.ScMapEntry({ key: entry.key(), val: value })
      : entry,
  );
  return rebuildEvent(raw, { data: xdr.ScVal.scvMap(entries) });
}

function replacePolicyContextRecipient(raw: string, recipient: string): string {
  const diagnostic = xdr.DiagnosticEvent.fromXDR(raw, "base64");
  const data = diagnostic.event().body().v0().data();
  const entries = (data.map() ?? []).map((entry) => {
    if (entry.key().switch().name !== "scvSymbol" || entry.key().sym().toString() !== "context") {
      return entry;
    }
    const context = entry.val();
    const call = context.vec()?.[1];
    const argsField = call?.map()?.find(
      (field) => field.key().switch().name === "scvSymbol" && field.key().sym().toString() === "args",
    );
    const args = argsField?.val().vec();
    if (!argsField || !args || args.length !== 3) throw new Error("Unexpected proof context shape");
    argsField.val(xdr.ScVal.scvVec([args[0]!, Address.fromString(recipient).toScVal(), args[2]!]));
    return new xdr.ScMapEntry({ key: entry.key(), val: context });
  });
  return rebuildEvent(raw, { data: xdr.ScVal.scvMap(entries) });
}

const successfulContractEvents = contractEvents(simulation.events);
const policyEvent = successfulContractEvents.find((raw) => {
  const topics = xdr.DiagnosticEvent.fromXDR(raw, "base64").event().body().v0().topics();
  return topics[0]?.switch().name === "scvSymbol" && topics[0].sym().toString() === "spending_limit_enforced";
})!;
const transferEvent = successfulContractEvents.find((raw) => {
  const topics = xdr.DiagnosticEvent.fromXDR(raw, "base64").event().body().v0().topics();
  return topics[0]?.switch().name === "scvSymbol" && topics[0].sym().toString() === "transfer";
})!;

describe("policy-aware simulation event validation", () => {
  test("accepts the exact proof events rejected by the hosted facilitator", () => {
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: simulation.events,
      expected,
      manifest,
    });
    expect(result).toEqual({
      valid: true,
      transferEventCount: 1,
      approvedPolicyEvents: [
        {
          kind: OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
          contractId: deployment.policy,
          eventName: "spending_limit_enforced",
        },
      ],
    });
  });

  test("rejects an approved event name emitted by an unapproved contract", () => {
    const malicious = rebuildEvent(policyEvent, { contractId: Buffer.alloc(32, 7) });
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [malicious, transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "POLICY_EVENT_UNAPPROVED" });
  });

  test("rejects an unrelated extra contract event", () => {
    const unrelated = rebuildEvent(policyEvent, { eventName: "unrelated_event" });
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [unrelated, transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "POLICY_EVENT_MALFORMED" });
  });

  test("rejects duplicate policy events", () => {
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [policyEvent, policyEvent, transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "POLICY_EVENT_DUPLICATE" });
  });

  test("rejects a missing required policy event", () => {
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "POLICY_EVENT_MALFORMED" });
  });

  test("rejects a policy amount that differs from the transfer", () => {
    const changed = replacePolicyField(
      policyEvent,
      "amount",
      xdr.ScVal.scvI128(new xdr.Int128Parts({
        hi: xdr.Int64.fromString("0"),
        lo: xdr.Uint64.fromString("99999"),
      })),
    );
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [changed, transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "POLICY_EVENT_CONTEXT_MISMATCH" });
  });

  test("rejects a policy rule ID that differs from the signed rule", () => {
    const changed = replacePolicyField(policyEvent, "context_rule_id", xdr.ScVal.scvU32(99));
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [changed, transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "POLICY_EVENT_CONTEXT_MISMATCH" });
  });

  test("rejects an altered recipient embedded in the policy context", () => {
    const attacker = Keypair.random().publicKey();
    const changed = replacePolicyContextRecipient(policyEvent, attacker);
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [changed, transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "POLICY_EVENT_CONTEXT_MISMATCH" });
  });

  test("rejects a second transfer event", () => {
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [policyEvent, transferEvent, transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "TRANSFER_EVENT_DUPLICATE" });
  });

  test("rejects policy events outside successful calls", () => {
    const failed = rebuildEvent(policyEvent, { successful: false });
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [failed, transferEvent],
      expected,
      manifest,
    });
    expect(result).toMatchObject({ valid: false, reason: "EVENT_NOT_TRANSFER" });
  });

  test("rejects a pinned code hash mismatch", () => {
    const pinned: FacilitatorPolicyManifest = {
      ...manifest,
      adapters: [
        {
          kind: OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
          contractId: deployment.policy,
          expectedWasmHash: "11".repeat(32),
          required: true,
        },
      ],
    };
    const result = validatePolicyAwareSimulationEvents({
      diagnosticEvents: [policyEvent, transferEvent],
      expected,
      manifest: pinned,
      observedWasmHashes: { [deployment.policy]: "22".repeat(32) },
    });
    expect(result).toMatchObject({
      valid: false,
      reason: "FACILITATOR_POLICY_MANIFEST_MISMATCH",
    });
  });

  test("helper fixture contract ID remains canonical", () => {
    expect(StrKey.encodeContract(Buffer.alloc(32, 7))).toMatch(/^C/);
  });
});
