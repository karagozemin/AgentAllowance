import {
  Account,
  Address,
  authorizeEntry,
  authorizeInvocation,
  buildAuthorizationEntryPreimage,
  hash,
  Keypair,
  Networks,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import {
  applyWalletAdminSignature,
  validateSignedWalletAdminEntry,
  type AdminConfig,
  type PreparedWalletAdminCall,
} from "../src/index.js";

const admin = Keypair.random();
const source = Keypair.random();
const treasury = Address.contract(Buffer.alloc(32, 4)).toString();
const config: AdminConfig = {
  rpcUrl: "http://127.0.0.1:8000",
  horizonUrl: "http://127.0.0.1:8001",
  networkPassphrase: Networks.TESTNET,
  treasuryContract: treasury,
  assetContract: treasury,
  spendingPolicy: treasury,
  recipientPolicy: treasury,
  adminAddress: admin.publicKey(),
  transactionSource: source,
};

async function fixture() {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(treasury).toScAddress(),
        functionName: "__check_auth",
        args: [xdr.ScVal.scvBytes(Buffer.alloc(32, 7))],
      }),
    ),
    subInvocations: [],
  });
  const unsigned = await authorizeInvocation({
    publicKey: admin.publicKey(),
    signer: async () => ({ signatureScVal: xdr.ScVal.scvVec([]) }),
    validUntilLedgerSeq: 1234,
    invocation,
    networkPassphrase: Networks.TESTNET,
  });
  const signed = await authorizeEntry(unsigned, admin, 1234, Networks.TESTNET);
  const preimage = buildAuthorizationEntryPreimage(unsigned, 1234, Networks.TESTNET);
  const prepared: PreparedWalletAdminCall = {
    method: "remove_context_rule",
    argsXdr: [],
    sourceSequence: new Account(source.publicKey(), "1").sequenceNumber(),
    smartAccountEntryXdr: unsigned.toXDR("base64"),
    unsignedAdminEntryXdr: unsigned.toXDR("base64"),
    adminAuthPreimageXdr: preimage.toXDR("base64"),
    validUntilLedgerSeq: 1234,
  };
  return { prepared, preimage, signed };
}

describe("wallet admin authorization validation", () => {
  test("accepts the exact wallet-signed template", async () => {
    const { prepared, signed } = await fixture();
    expect(validateSignedWalletAdminEntry(config, prepared, signed.toXDR("base64")))
      .toBeInstanceOf(xdr.SorobanAuthorizationEntry);
  });

  test("rejects a changed signer, nonce, or invocation", async () => {
    const { prepared, signed } = await fixture();
    const wrongSigner = xdr.SorobanAuthorizationEntry.fromXDR(signed.toXDR("base64"), "base64");
    wrongSigner.credentials().address().address(Address.fromString(Keypair.random().publicKey()).toScAddress());
    expect(() => validateSignedWalletAdminEntry(config, prepared, wrongSigner.toXDR("base64"))).toThrow();

    const changedNonce = xdr.SorobanAuthorizationEntry.fromXDR(signed.toXDR("base64"), "base64");
    changedNonce.credentials().address().nonce(xdr.Int64.fromString("99"));
    expect(() => validateSignedWalletAdminEntry(config, prepared, changedNonce.toXDR("base64")))
      .toThrow("changed the prepared authorization");

    const changedInvocation = xdr.SorobanAuthorizationEntry.fromXDR(signed.toXDR("base64"), "base64");
    changedInvocation.rootInvocation().subInvocations([signed.rootInvocation()]);
    expect(() => validateSignedWalletAdminEntry(config, prepared, changedInvocation.toXDR("base64")))
      .toThrow("changed the prepared authorization");
  });

  test("assembles the exact auth entry from a Freighter preimage signature", async () => {
    const { prepared, preimage } = await fixture();
    const walletSignature = admin.sign(hash(preimage.toXDR())).toString("base64");
    const signed = await applyWalletAdminSignature(config, prepared, walletSignature);
    expect(Address.fromScAddress(signed.credentials().address().address()).toString())
      .toBe(admin.publicKey());
    expect(signed.credentials().address().signature().vec()).toHaveLength(1);
  });

  test("rejects malformed, wrong-wallet, and changed-preimage signatures", async () => {
    const { prepared, preimage } = await fixture();
    await expect(applyWalletAdminSignature(config, prepared, "not-base64"))
      .rejects.toThrow("canonical base64");
    const wrongSignature = Keypair.random().sign(hash(preimage.toXDR())).toString("base64");
    await expect(applyWalletAdminSignature(config, prepared, wrongSignature))
      .rejects.toThrow("does not match treasury admin");
    await expect(applyWalletAdminSignature(config, {
      ...prepared,
      adminAuthPreimageXdr: xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
        new xdr.HashIdPreimageSorobanAuthorization({
          networkId: Buffer.alloc(32, 9),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 1234,
          invocation: preparedInvocation(prepared),
        }),
      ).toXDR("base64"),
    }, admin.sign(hash(preimage.toXDR())).toString("base64")))
      .rejects.toThrow("preimage changed");
  });
});

function preparedInvocation(prepared: PreparedWalletAdminCall): xdr.SorobanAuthorizedInvocation {
  return xdr.SorobanAuthorizationEntry.fromXDR(prepared.unsignedAdminEntryXdr, "base64").rootInvocation();
}
