import { Address, Keypair, xdr } from "@stellar/stellar-sdk";
import { describe, expect, test, vi } from "vitest";
import type { FacilitatorPolicyManifest } from "@agentallowance/facilitator-policy";
import { resolveRecipientPolicyRule } from "../src/stellar/allowance-rule.js";

const recipientPolicy = "CAA6UW3PMALFDMMJG3AFJVVFGQT4CCSJT247MHJUHP7CC5IFPXXNKFSL";
const payer = "CDHMMKMC7L54AY5WWUDTFMTQFKEI5GO3U7NQCOUC4SFYICSQ5EQTBQCX";
const token = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const recipient = Keypair.random().publicKey();

function configValue(): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("recipient"),
      val: Address.fromString(recipient).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("token"),
      val: Address.fromString(token).toScVal(),
    }),
  ]);
}

const manifest: FacilitatorPolicyManifest = {
  id: "dynamic-test",
  network: "stellar:testnet",
  smartAccount: payer,
  recipientPolicy: {
    contractId: recipientPolicy,
    expectedWasmHash: "11".repeat(32),
  },
  adapters: [{
    kind: "openzeppelin-stellar-accounts/spending-limit@0.7.2",
    contractId: "CAMI5B457BBE4OI3B2FLGSHFCJDX5Y2ZROCTKCHX4JEZD3FQE4ICBMJP",
    expectedWasmHash: "22".repeat(32),
    required: true,
  }],
};

describe("dynamic allowance rule lookup", () => {
  test("decodes the raw simulateTransaction response returned by OpenZeppelin Relayer", async () => {
    const rpc = vi.fn(async () => ({
      result: {
        id: "1",
        latestLedger: 123,
        results: [{ xdr: configValue().toXDR("base64") }],
      },
    }));
    const result = await resolveRecipientPolicyRule({
      relayer: { rpc } as never,
      sourceAddress: Keypair.random().publicKey(),
      networkPassphrase: "Test SDF Network ; September 2015",
      manifest,
      contextRuleId: 2,
      payer,
    });
    expect(result).toEqual({ contextRuleId: 2, token, recipient });
    expect(rpc).toHaveBeenCalledOnce();
  });
});
