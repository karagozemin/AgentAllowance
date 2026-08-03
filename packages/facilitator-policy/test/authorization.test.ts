import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { Networks, xdr } from "@stellar/stellar-sdk";
import {
  OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
  validateDelegatedPaymentTransaction,
  verifyPolicyAwarePayment,
} from "../src/index.js";

const runDirectory = fileURLToPath(
  new URL("../../../proofs/stellar-x402-smart-account/artifacts/runs/2026-07-31T21-31-07-556Z/", import.meta.url),
);
const deployment = JSON.parse(readFileSync(`${runDirectory}/deployment.json`, "utf8")) as {
  token: string;
  smartAccount: string;
  merchant: string;
  ruleId: number;
  paymentAmount: string;
};
const transactionXdr = readFileSync(`${runDirectory}/transaction.xdr`, "utf8").trim();
const simulation = JSON.parse(
  readFileSync(`${runDirectory}/simulation-enforce-response.json`, "utf8"),
) as { events: string[] };

function mutateAuthEntries(
  mutate: (entries: xdr.SorobanAuthorizationEntry[]) => xdr.SorobanAuthorizationEntry[],
): string {
  const envelope = xdr.TransactionEnvelope.fromXDR(transactionXdr, "base64");
  const operation = envelope.v1().tx().operations()[0]!;
  const invoke = operation.body().invokeHostFunctionOp();
  invoke.auth(mutate([...invoke.auth()]));
  return envelope.toXDR("base64");
}

function expectedPayment() {
  return {
    token: deployment.token,
    from: deployment.smartAccount,
    to: deployment.merchant,
    amount: BigInt(deployment.paymentAmount),
    contextRuleId: deployment.ruleId,
  };
}

describe("delegated smart-account transaction validation", () => {
  test("accepts the proof's two-entry authorization structure", async () => {
    const result = await validateDelegatedPaymentTransaction({
      transactionXdr,
      networkPassphrase: Networks.TESTNET,
      expected: expectedPayment(),
    });
    expect(result).toMatchObject({
      valid: true,
      payer: deployment.smartAccount,
      contextRuleId: deployment.ruleId,
    });
  });

  test("rejects a transaction with a malicious third auth entry", async () => {
    const result = await validateDelegatedPaymentTransaction({
      transactionXdr: mutateAuthEntries((entries) => [...entries, entries[1]!]),
      networkPassphrase: Networks.TESTNET,
      expected: expectedPayment(),
    });
    expect(result).toMatchObject({ valid: false, reason: "AUTH_STRUCTURE_INVALID" });
  });

  test("rejects a missing delegated authorization entry", async () => {
    const result = await validateDelegatedPaymentTransaction({
      transactionXdr: mutateAuthEntries((entries) => [entries[0]!]),
      networkPassphrase: Networks.TESTNET,
      expected: expectedPayment(),
    });
    expect(result).toMatchObject({ valid: false, reason: "AUTH_STRUCTURE_INVALID" });
  });

  test("rejects a delegated digest not bound to the payer payload", async () => {
    const changed = mutateAuthEntries((entries) => {
      entries[1]!.rootInvocation().function().contractFn().args([
        xdr.ScVal.scvBytes(Buffer.alloc(32, 44)),
      ]);
      return entries;
    });
    const result = await validateDelegatedPaymentTransaction({
      transactionXdr: changed,
      networkPassphrase: Networks.TESTNET,
      expected: expectedPayment(),
    });
    expect(result).toMatchObject({ valid: false, reason: "AUTH_DIGEST_MISMATCH" });
  });

  test("rejects any auth-entry subinvocation", async () => {
    const changed = mutateAuthEntries((entries) => {
      entries[1]!.rootInvocation().subInvocations([entries[0]!.rootInvocation()]);
      return entries;
    });
    const result = await validateDelegatedPaymentTransaction({
      transactionXdr: changed,
      networkPassphrase: Networks.TESTNET,
      expected: expectedPayment(),
    });
    expect(result).toMatchObject({ valid: false, reason: "AUTH_STRUCTURE_INVALID" });
  });

  test("rejects unexpected signed context rule IDs", async () => {
    const changed = mutateAuthEntries((entries) => {
      const signature = entries[0]!.credentials().address().signature();
      const ruleIds = signature.map()?.find(
        (field) =>
          field.key().switch().name === "scvSymbol" &&
          field.key().sym().toString() === "context_rule_ids",
      );
      ruleIds?.val(xdr.ScVal.scvVec([xdr.ScVal.scvU32(deployment.ruleId), xdr.ScVal.scvU32(99)]));
      return entries;
    });
    const result = await validateDelegatedPaymentTransaction({
      transactionXdr: changed,
      networkPassphrase: Networks.TESTNET,
      expected: expectedPayment(),
    });
    expect(result).toMatchObject({ valid: false, reason: "AUTH_RULE_SELECTION_INVALID" });
  });

  test("returns a valid policy-aware facilitator decision for the proof", async () => {
    const result = await verifyPolicyAwarePayment({
      x402Version: 2,
      transactionXdr,
      paymentRequirements: {
        scheme: "exact",
        network: "stellar:testnet",
        amount: deployment.paymentAmount,
        payTo: deployment.merchant,
        asset: deployment.token,
      },
      simulationEvents: simulation.events,
      manifest: {
        id: "proof-openzeppelin-0.7.2",
        network: "stellar:testnet",
        smartAccount: deployment.smartAccount,
        expectedRuleId: deployment.ruleId,
        adapters: [
          {
            kind: OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
            contractId: JSON.parse(readFileSync(`${runDirectory}/deployment.json`, "utf8")).policy,
            required: true,
          },
        ],
      },
    });
    expect(result).toMatchObject({
      isValid: true,
      payer: deployment.smartAccount,
      contextRuleId: deployment.ruleId,
    });
  });

  test("accepts a dynamically selected rule only when recipient policy state matches", async () => {
    const policy = JSON.parse(readFileSync(`${runDirectory}/deployment.json`, "utf8")).policy as string;
    const recipientPolicy = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
    const result = await verifyPolicyAwarePayment({
      x402Version: 2,
      transactionXdr,
      paymentRequirements: {
        scheme: "exact",
        network: "stellar:testnet",
        amount: deployment.paymentAmount,
        payTo: deployment.merchant,
        asset: deployment.token,
      },
      simulationEvents: simulation.events,
      manifest: {
        id: "dynamic-openzeppelin-0.7.2",
        network: "stellar:testnet",
        smartAccount: deployment.smartAccount,
        recipientPolicy: { contractId: recipientPolicy, expectedWasmHash: "22".repeat(32) },
        adapters: [{
          kind: OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
          contractId: policy,
          expectedWasmHash: "11".repeat(32),
          required: true,
        }],
      },
      observedWasmHashes: {
        [policy]: "11".repeat(32),
        [recipientPolicy]: "22".repeat(32),
      },
      resolveAllowanceRule: async (contextRuleId) => ({
        contextRuleId,
        token: deployment.token,
        recipient: deployment.merchant,
      }),
    });
    expect(result).toMatchObject({ isValid: true, contextRuleId: deployment.ruleId });
  });

  test("rejects a dynamic rule whose recipient policy state does not match", async () => {
    const policy = JSON.parse(readFileSync(`${runDirectory}/deployment.json`, "utf8")).policy as string;
    const recipientPolicy = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
    const result = await verifyPolicyAwarePayment({
      x402Version: 2,
      transactionXdr,
      paymentRequirements: {
        scheme: "exact",
        network: "stellar:testnet",
        amount: deployment.paymentAmount,
        payTo: deployment.merchant,
        asset: deployment.token,
      },
      simulationEvents: simulation.events,
      manifest: {
        id: "dynamic-openzeppelin-0.7.2",
        network: "stellar:testnet",
        smartAccount: deployment.smartAccount,
        recipientPolicy: { contractId: recipientPolicy, expectedWasmHash: "22".repeat(32) },
        adapters: [{
          kind: OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
          contractId: policy,
          expectedWasmHash: "11".repeat(32),
          required: true,
        }],
      },
      observedWasmHashes: {
        [policy]: "11".repeat(32),
        [recipientPolicy]: "22".repeat(32),
      },
      resolveAllowanceRule: async (contextRuleId) => ({
        contextRuleId,
        token: deployment.token,
        recipient: deployment.smartAccount,
      }),
    });
    expect(result).toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_policy_manifest_mismatch",
    });
  });
});
