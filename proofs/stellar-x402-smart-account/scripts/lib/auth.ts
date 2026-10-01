import {
  Address,
  authorizeEntry,
  hash,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "./config.js";

export type InvokeSpec = {
  token: string;
  from: string;
  to: string;
  amount: bigint;
};

export function i128(value: bigint): xdr.ScVal {
  const uint = xdr.Uint64.fromString(value.toString());
  return xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: uint, hi: xdr.Int64.fromString("0") }));
}

export function transferInvocation(spec: InvokeSpec): xdr.SorobanAuthorizedInvocation {
  const args = [
    Address.fromString(spec.from).toScVal(),
    Address.fromString(spec.to).toScVal(),
    i128(spec.amount),
  ];
  const invoke = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(spec.token).toScAddress(),
    functionName: "transfer",
    args,
  });
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke),
    subInvocations: [],
  });
}

function authPayloadScVal(delegate: string, ruleId: number, payload: Buffer): xdr.ScVal {
  const ruleIds = nativeToScVal([ruleId], { type: "u32" });
  const authDigest = hash(Buffer.concat([payload, ruleIds.toXDR("raw")]));
  const signer = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Delegated"),
    Address.fromString(delegate).toScVal(),
  ]);
  const signerEntry = new xdr.ScMapEntry({
    key: signer,
    val: xdr.ScVal.scvBytes(Buffer.alloc(0)),
  });
  const signers = xdr.ScVal.scvMap([signerEntry]);
  const payloadEntry = new xdr.ScMapEntry({
    key: xdr.ScVal.scvSymbol("context_rule_ids"),
    val: ruleIds,
  });
  const signersEntry = new xdr.ScMapEntry({
    key: xdr.ScVal.scvSymbol("signers"),
    val: signers,
  });
  return xdr.ScVal.scvMap([payloadEntry, signersEntry]);
}

export async function signSmartAccountEntry(
  entry: xdr.SorobanAuthorizationEntry,
  validUntil: number,
  delegate: string,
  ruleId: number,
): Promise<{ entry: xdr.SorobanAuthorizationEntry; authDigest: Buffer }> {
  let authDigest = Buffer.alloc(0) as Buffer<ArrayBufferLike>;
  const signed = await authorizeEntry(
    entry,
    async (_preimage, payload) => {
      const ruleIds = nativeToScVal([ruleId], { type: "u32" });
      authDigest = hash(Buffer.concat([payload, ruleIds.toXDR("raw")]));
      return { signatureScVal: authPayloadScVal(delegate, ruleId, payload) };
    },
    validUntil,
    NETWORK_PASSPHRASE,
  );
  return { entry: signed, authDigest: authDigest as unknown as Buffer };
}
