import { describe, expect, test } from "vitest";
import { Address, Keypair, scValToNative } from "@stellar/stellar-sdk";
import {
  computeAuthDigest,
  contextRuleIdsScVal,
  transferInvocation,
} from "../src/index.js";

describe("smart-account authorization primitives", () => {
  test("binds the selected context rule IDs into the digest", () => {
    const signaturePayload = Buffer.alloc(32, 9);
    const first = computeAuthDigest(signaturePayload, [1]);
    const second = computeAuthDigest(signaturePayload, [2]);

    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(false);
    expect(contextRuleIdsScVal([1]).vec()?.[0]?.u32()).toBe(1);
  });

  test("builds an exact SEP-41 transfer root with no subinvocations", () => {
    const token = Address.contract(Buffer.alloc(32, 1)).toString();
    const from = Keypair.random().publicKey();
    const to = Keypair.random().publicKey();
    const invocation = transferInvocation({ token, from, to, amount: 100n });
    const call = invocation.function().contractFn();

    expect(invocation.subInvocations()).toHaveLength(0);
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(token);
    expect(call.functionName().toString()).toBe("transfer");
    expect(call.args().map(scValToNative)).toEqual([from, to, 100n]);
  });
});
