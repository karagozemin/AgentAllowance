import { describe, expect, test } from "vitest";
import {
  OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
  assertProductionManifest,
  type FacilitatorPolicyManifest,
} from "../src/index.js";

const manifest: FacilitatorPolicyManifest = {
  id: "testnet-profile",
  network: "stellar:testnet",
  smartAccount: "CAC4C6WUVBSDQUKYQFMHYEJLTBLRWTWTFJWPQB6E43NXX3YA26GFZWEV",
  expectedRuleId: 0,
  adapters: [{
    kind: OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
    contractId: "CASICWW33P3PIZ4ZTUZPOVVIFVTXJH3HW7SIILF6UMXQ2NDNFCOCRE7N",
    expectedWasmHash: "11".repeat(32),
    required: true,
  }],
};

describe("production policy manifest", () => {
  test("accepts the single pinned spending-limit adapter", () => {
    expect(() => assertProductionManifest(manifest)).not.toThrow();
  });

  test("rejects recipient-event adapters in the MVP", () => {
    const recipient = {
      ...manifest,
      adapters: [{ ...manifest.adapters[0], kind: "recipient_policy_enforced" }],
    } as unknown as FacilitatorPolicyManifest;
    expect(() => assertProductionManifest(recipient)).toThrow(/Unsupported policy adapter/);
  });

  test("rejects optional or additional policy events", () => {
    expect(() => assertProductionManifest({
      ...manifest,
      adapters: [{ ...manifest.adapters[0]!, required: false }],
    })).toThrow(/must be required/);
    expect(() => assertProductionManifest({
      ...manifest,
      adapters: [manifest.adapters[0]!, manifest.adapters[0]!],
    })).toThrow(/exactly one/);
  });

  test("accepts a dynamic rule profile only with a pinned recipient policy", () => {
    const dynamic: FacilitatorPolicyManifest = {
      ...manifest,
      expectedRuleId: undefined,
      recipientPolicy: {
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
        expectedWasmHash: "22".repeat(32),
      },
    };
    expect(() => assertProductionManifest(dynamic)).not.toThrow();
    expect(() => assertProductionManifest({ ...dynamic, recipientPolicy: undefined }))
      .toThrow(/recipient-policy contract/);
  });
});
