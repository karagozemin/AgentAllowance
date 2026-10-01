import {
  Address,
  authorizeEntry,
  authorizeInvocation,
  hash,
  Keypair,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

export type TransferSpec = {
  token: string;
  from: string;
  to: string;
  amount: bigint;
};

export type DelegatedAuthorizationOptions = {
  smartAccountEntry: xdr.SorobanAuthorizationEntry;
  delegate: Keypair;
  contextRuleIds: number[];
  validUntilLedgerSeq: number;
  networkPassphrase: string;
};

export function i128(value: bigint): xdr.ScVal {
  if (value < 0n) throw new RangeError("i128 helper only accepts non-negative payment amounts");
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      lo: xdr.Uint64.fromString(value.toString()),
      hi: xdr.Int64.fromString("0"),
    }),
  );
}

export function transferInvocation(spec: TransferSpec): xdr.SorobanAuthorizedInvocation {
  const invoke = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(spec.token).toScAddress(),
    functionName: "transfer",
    args: [
      Address.fromString(spec.from).toScVal(),
      Address.fromString(spec.to).toScVal(),
      i128(spec.amount),
    ],
  });

  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke),
    subInvocations: [],
  });
}

export function contextRuleIdsScVal(contextRuleIds: number[]): xdr.ScVal {
  if (contextRuleIds.length === 0) throw new Error("At least one context rule ID is required");
  return nativeToScVal(contextRuleIds, { type: "u32" });
}

export function computeAuthDigest(signaturePayload: Buffer, contextRuleIds: number[]): Buffer {
  return hash(Buffer.concat([signaturePayload, contextRuleIdsScVal(contextRuleIds).toXDR("raw")]));
}

export function authPayloadScVal(
  delegate: string,
  contextRuleIds: number[],
): xdr.ScVal {
  const signer = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Delegated"),
    Address.fromString(delegate).toScVal(),
  ]);
  const signers = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: signer, val: xdr.ScVal.scvBytes(Buffer.alloc(0)) }),
  ]);

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("context_rule_ids"),
      val: contextRuleIdsScVal(contextRuleIds),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signers"), val: signers }),
  ]);
}

export async function buildDelegatedAuthorizationEntries(
  options: DelegatedAuthorizationOptions,
): Promise<{
  smartAccountEntry: xdr.SorobanAuthorizationEntry;
  delegatedSignerEntry: xdr.SorobanAuthorizationEntry;
  authDigest: Buffer;
}> {
  const delegateAddress = options.delegate.publicKey();
  let authDigest: Buffer | undefined;

  const smartAccountEntry = await authorizeEntry(
    options.smartAccountEntry,
    async (_preimage, signaturePayload) => {
      authDigest = computeAuthDigest(signaturePayload, options.contextRuleIds);
      return {
        signatureScVal: authPayloadScVal(
          delegateAddress,
          options.contextRuleIds,
        ),
      };
    },
    options.validUntilLedgerSeq,
    options.networkPassphrase,
  );

  if (!authDigest) throw new Error("Stellar SDK did not produce an authorization payload");

  const delegatedInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: smartAccountEntry.credentials().address().address(),
        functionName: "__check_auth",
        args: [xdr.ScVal.scvBytes(authDigest)],
      }),
    ),
    subInvocations: [],
  });

  const delegatedSignerEntry = await authorizeInvocation({
    signer: options.delegate,
    validUntilLedgerSeq: options.validUntilLedgerSeq,
    invocation: delegatedInvocation,
    networkPassphrase: options.networkPassphrase,
  });

  return { smartAccountEntry, delegatedSignerEntry, authDigest };
}
