import { describe, expect, test } from "vitest";
import { Address, Keypair, Networks, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  buildDelegatedAuthorizationTemplate,
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

  test("builds an unsigned Freighter-compatible delegated admin entry", async () => {
    const treasury = Address.contract(Buffer.alloc(32, 3));
    const admin = Keypair.random().publicKey();
    const rootInvocation = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: treasury.toScAddress(),
          functionName: "add_context_rule",
          args: [],
        }),
      ),
      subInvocations: [],
    });
    const smartAccountEntry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
        address: treasury.toScAddress(),
        nonce: xdr.Int64.fromString("7"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVec([]),
      })),
      rootInvocation,
    });
    const result = await buildDelegatedAuthorizationTemplate({
      smartAccountEntry,
      delegate: admin,
      contextRuleIds: [0],
      validUntilLedgerSeq: 1234,
      networkPassphrase: Networks.TESTNET,
    });
    const credentials = result.delegatedSignerEntry.credentials().address();
    expect(Address.fromScAddress(credentials.address()).toString()).toBe(admin);
    expect(credentials.signatureExpirationLedger()).toBe(1234);
    expect(credentials.signature().vec()).toEqual([]);
    expect(result.delegatedSignerEntry.rootInvocation().subInvocations()).toEqual([]);
    expect(result.authDigest).toHaveLength(32);
  });
});
