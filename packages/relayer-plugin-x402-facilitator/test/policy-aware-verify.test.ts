import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, test, vi } from "vitest";
import { OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2 } from "@agentallowance/facilitator-policy";
import { verify } from "../src/stellar/verify.js";
import * as policyHashes from "../src/stellar/policy-hashes.js";
import type { NetworkConfig, VerifyRequest } from "../src/types.js";

const runDirectory = fileURLToPath(
  new URL("../../../test/fixtures/stellar-policy-payment/", import.meta.url),
);
const deployment = JSON.parse(readFileSync(`${runDirectory}/deployment.json`, "utf8")) as {
  token: string;
  smartAccount: string;
  merchant: string;
  policy: string;
  delegate: string;
  paymentAmount: string;
  ruleId: number;
};
const simulation = JSON.parse(
  readFileSync(`${runDirectory}/simulation-enforce-response.json`, "utf8"),
) as Record<string, unknown>;
const transaction = readFileSync(`${runDirectory}/transaction.xdr`, "utf8").trim();
const expectedWasmHash = "11".repeat(32);

function request(): VerifyRequest {
  const requirements = {
    scheme: "exact" as const,
    network: "stellar:testnet",
    amount: deployment.paymentAmount,
    payTo: deployment.merchant,
    maxTimeoutSeconds: 30,
    asset: deployment.token,
    extra: { areFeesSponsored: true },
  };
  return {
    paymentPayload: { x402Version: 2, accepted: requirements, payload: { transaction } },
    paymentRequirements: requirements,
  };
}

function config(): NetworkConfig {
  return {
    network: "stellar:testnet",
    type: "stellar",
    relayer_id: "agentallowance-testnet",
    assets: [deployment.token],
    policy_manifests: [{
      id: "proof-openzeppelin-0.7.2",
      network: "stellar:testnet",
      smartAccount: deployment.smartAccount,
      expectedRuleId: deployment.ruleId,
      adapters: [{
        kind: OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
        contractId: deployment.policy,
        expectedWasmHash,
        required: true,
      }],
    }],
  };
}

function api(relayerAddress = Keypair.random().publicKey()) {
  const relayer = {
    getRelayer: vi.fn().mockResolvedValue({ network: "testnet", address: relayerAddress }),
    rpc: vi.fn().mockImplementation(async (body: { method: string }) => {
      if (body.method === "getLatestLedger") return { result: { sequence: 3_902_834 } };
      if (body.method === "simulateTransaction") return { result: simulation };
      throw new Error(`Unexpected RPC method ${body.method}`);
    }),
  };
  return { useRelayer: vi.fn().mockReturnValue(relayer) } as never;
}

describe("policy-aware OpenZeppelin facilitator verification", () => {
  test("accepts the proven transfer plus pinned spending-limit event", async () => {
    vi.spyOn(policyHashes, "resolvePolicyWasmHashes").mockResolvedValue({
      [deployment.policy]: expectedWasmHash,
    });
    await expect(verify(request(), api(), config())).resolves.toEqual({
      isValid: true,
      payer: deployment.smartAccount,
    });
  });

  test("rejects the correct event when the live WASM hash is not approved", async () => {
    vi.spyOn(policyHashes, "resolvePolicyWasmHashes").mockResolvedValue({
      [deployment.policy]: "22".repeat(32),
    });
    await expect(verify(request(), api(), config())).resolves.toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_policy_manifest_mismatch",
    });
  });

  test("rejects the relayer as merchant or delegated auth address", async () => {
    vi.spyOn(policyHashes, "resolvePolicyWasmHashes").mockResolvedValue({
      [deployment.policy]: expectedWasmHash,
    });
    await expect(verify(request(), api(deployment.merchant), config())).resolves.toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_unsafe_policy_participant",
    });
    await expect(verify(request(), api(deployment.delegate), config())).resolves.toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_facilitator_in_auth",
    });
  });

  test("accepts a payer selected by an approved smart-account WASM hash", async () => {
    const network = config();
    network.policy_manifests = [{
      ...network.policy_manifests![0]!,
      smartAccount: undefined,
      smartAccountWasmHash: "33".repeat(32),
    }];
    vi.spyOn(policyHashes, "resolvePolicyWasmHashes").mockResolvedValue({
      [deployment.smartAccount]: "33".repeat(32),
      [deployment.policy]: expectedWasmHash,
    });
    await expect(verify(request(), api(), network)).resolves.toEqual({
      isValid: true,
      payer: deployment.smartAccount,
    });
  });

  test("rejects an otherwise valid payment from an unapproved smart-account WASM", async () => {
    const network = config();
    network.policy_manifests = [{
      ...network.policy_manifests![0]!,
      smartAccount: undefined,
      smartAccountWasmHash: "33".repeat(32),
    }];
    vi.spyOn(policyHashes, "resolvePolicyWasmHashes").mockResolvedValue({
      [deployment.smartAccount]: "44".repeat(32),
      [deployment.policy]: expectedWasmHash,
    });
    await expect(verify(request(), api(), network)).resolves.toMatchObject({
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_event_not_transfer",
    });
  });
});
