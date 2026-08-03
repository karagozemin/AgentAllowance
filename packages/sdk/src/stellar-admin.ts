import {
  Account,
  Address,
  Contract,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  nativeToScVal,
  rpc,
  scvSortedMap,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  buildDelegatedAuthorizationEntries,
  buildDelegatedAuthorizationTemplate,
} from "@agentallowance/stellar-smart-account-auth";

export type AdminConfig = {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  treasuryContract: string;
  assetContract: string;
  spendingPolicy: string;
  recipientPolicy: string;
  adminAddress: string;
  adminSigner?: Keypair;
  transactionSource: Keypair;
  adminRuleId?: number;
};

export type CreateRuleInput = {
  label: string;
  delegatedSigner: string;
  maxSpendAtomic: bigint;
  windowLedgers: number;
  recipient: string;
  validUntilLedger: number;
};

export type PreparedWalletAdminCall = {
  method: "add_context_rule" | "remove_context_rule";
  argsXdr: string[];
  sourceSequence: string;
  smartAccountEntryXdr: string;
  unsignedAdminEntryXdr: string;
  adminAuthPreimageXdr: string;
  validUntilLedgerSeq: number;
};

function variant(name: string, ...values: xdr.ScVal[]): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name), ...values]);
}

function sortedMap(entries: xdr.ScMapEntry[]): xdr.ScVal {
  return scvSortedMap(entries);
}

function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return sortedMap(Object.entries(fields).map(([key, value]) => new xdr.ScMapEntry({
    key: xdr.ScVal.scvSymbol(key),
    val: value,
  })));
}

function unsignedI128(value: bigint): xdr.ScVal {
  if (value <= 0n) throw new Error("Spending limit must be positive");
  return xdr.ScVal.scvI128(new xdr.Int128Parts({
    hi: xdr.Int64.fromString("0"),
    lo: xdr.Uint64.fromString(value.toString()),
  }));
}

function createRuleArgs(config: AdminConfig, input: CreateRuleInput): xdr.ScVal[] {
  if (!Number.isInteger(input.windowLedgers) || input.windowLedgers <= 0) {
    throw new Error("windowLedgers must be positive");
  }
  const policies = sortedMap([
    new xdr.ScMapEntry({
      key: Address.fromString(config.spendingPolicy).toScVal(),
      val: struct({
        period_ledgers: xdr.ScVal.scvU32(input.windowLedgers),
        spending_limit: unsignedI128(input.maxSpendAtomic),
      }),
    }),
    new xdr.ScMapEntry({
      key: Address.fromString(config.recipientPolicy).toScVal(),
      val: struct({
        recipient: Address.fromString(input.recipient).toScVal(),
        token: Address.fromString(config.assetContract).toScVal(),
      }),
    }),
  ]);
  return [
    variant("CallContract", Address.fromString(config.assetContract).toScVal()),
    xdr.ScVal.scvString(input.label.slice(0, 16)),
    xdr.ScVal.scvU32(input.validUntilLedger),
    xdr.ScVal.scvVec([variant("Delegated", Address.fromString(input.delegatedSigner).toScVal())]),
    policies,
  ];
}

function buildAdminTransaction(
  config: AdminConfig,
  method: string,
  args: xdr.ScVal[],
  sourceSequence: string,
  auth: xdr.SorobanAuthorizationEntry[],
) {
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(config.treasuryContract).toScAddress(),
    functionName: method,
    args,
  }));
  return new TransactionBuilder(new Account(config.transactionSource.publicKey(), sourceSequence), {
    fee: "1000000",
    networkPassphrase: config.networkPassphrase,
  }).addOperation(Operation.invokeHostFunction({ func, auth })).setTimeout(60).build();
}

export async function prepareWalletAdminCall(
  config: AdminConfig,
  method: PreparedWalletAdminCall["method"],
  args: xdr.ScVal[],
): Promise<PreparedWalletAdminCall> {
  const server = new rpc.Server(config.rpcUrl);
  const sourceSequence = (await new Horizon.Server(config.horizonUrl)
    .loadAccount(config.transactionSource.publicKey())).sequenceNumber();
  const recording = await server._simulateTransaction(
    buildAdminTransaction(config, method, args, sourceSequence, []), undefined, "record",
  );
  if (recording.error || !recording.results?.[0]?.auth) {
    throw new Error(`Admin recording simulation failed: ${recording.error ?? "missing auth"}`);
  }
  const payerEntry = recording.results[0].auth
    .map((raw) => xdr.SorobanAuthorizationEntry.fromXDR(raw, "base64"))
    .find((entry) => entry.credentials().switch().name === "sorobanCredentialsAddress" &&
      Address.fromScAddress(entry.credentials().address().address()).toString() === config.treasuryContract);
  if (!payerEntry) throw new Error("Admin simulation did not return treasury authorization");
  const validUntilLedgerSeq = Number(recording.latestLedger) + 12;
  const auth = await buildDelegatedAuthorizationTemplate({
    smartAccountEntry: payerEntry,
    delegate: config.adminAddress,
    contextRuleIds: [config.adminRuleId ?? 0],
    validUntilLedgerSeq,
    networkPassphrase: config.networkPassphrase,
  });
  const adminAuthPreimage = buildAuthorizationEntryPreimage(
    auth.delegatedSignerEntry,
    validUntilLedgerSeq,
    config.networkPassphrase,
  );
  return {
    method,
    argsXdr: args.map((value) => value.toXDR("base64")),
    sourceSequence,
    smartAccountEntryXdr: auth.smartAccountEntry.toXDR("base64"),
    unsignedAdminEntryXdr: auth.delegatedSignerEntry.toXDR("base64"),
    adminAuthPreimageXdr: adminAuthPreimage.toXDR("base64"),
    validUntilLedgerSeq,
  };
}

function decodeFreighterSignature(value: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(normalized)) {
    throw new Error("Freighter authorization signature must be canonical base64");
  }
  const signature = Buffer.from(normalized, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== normalized) {
    throw new Error("Freighter authorization signature must contain exactly 64 bytes");
  }
  return signature;
}

export async function applyWalletAdminSignature(
  config: AdminConfig,
  prepared: PreparedWalletAdminCall,
  walletSignature: string,
): Promise<xdr.SorobanAuthorizationEntry> {
  const unsigned = xdr.SorobanAuthorizationEntry.fromXDR(prepared.unsignedAdminEntryXdr, "base64");
  const expectedPreimage = buildAuthorizationEntryPreimage(
    unsigned,
    prepared.validUntilLedgerSeq,
    config.networkPassphrase,
  );
  if (expectedPreimage.toXDR("base64") !== prepared.adminAuthPreimageXdr) {
    throw new Error("Prepared admin authorization preimage changed");
  }
  const signature = decodeFreighterSignature(walletSignature);
  const signed = await authorizeEntry(
    unsigned,
    async (preimage, payload) => {
      if (preimage.toXDR("base64") !== prepared.adminAuthPreimageXdr) {
        throw new Error("Freighter signed a different admin authorization preimage");
      }
      if (!Keypair.fromPublicKey(config.adminAddress).verify(payload, signature)) {
        throw new Error("Freighter authorization signature does not match treasury admin");
      }
      return { signature, publicKey: config.adminAddress };
    },
    prepared.validUntilLedgerSeq,
    config.networkPassphrase,
  );
  return validateSignedWalletAdminEntry(config, prepared, signed.toXDR("base64"));
}

export function validateSignedWalletAdminEntry(config: AdminConfig, prepared: PreparedWalletAdminCall, signedXdr: string) {
  const unsigned = xdr.SorobanAuthorizationEntry.fromXDR(prepared.unsignedAdminEntryXdr, "base64");
  const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
  const unsignedCredentials = unsigned.credentials().address();
  const signedCredentials = signed.credentials().address();
  if (Address.fromScAddress(signedCredentials.address()).toString() !== config.adminAddress) {
    throw new Error("Signed admin entry address does not match treasury admin");
  }
  if (unsignedCredentials.nonce().toString() !== signedCredentials.nonce().toString() ||
      unsignedCredentials.signatureExpirationLedger() !== signedCredentials.signatureExpirationLedger() ||
      unsigned.rootInvocation().toXDR("base64") !== signed.rootInvocation().toXDR("base64")) {
    throw new Error("Signed admin entry changed the prepared authorization");
  }
  const signature = signedCredentials.signature();
  if (signature.switch().name !== "scvVec" || !signature.vec()?.length) {
    throw new Error("Signed admin entry is missing the wallet signature");
  }
  return signed;
}

export async function submitWalletAdminCall(
  config: AdminConfig,
  prepared: PreparedWalletAdminCall,
  walletSignature: string,
): Promise<{ transactionHash: string; retval: unknown }> {
  const server = new rpc.Server(config.rpcUrl);
  const sourceSequence = (await new Horizon.Server(config.horizonUrl)
    .loadAccount(config.transactionSource.publicKey())).sequenceNumber();
  const args = prepared.argsXdr.map((value) => xdr.ScVal.fromXDR(value, "base64"));
  const smartEntry = xdr.SorobanAuthorizationEntry.fromXDR(prepared.smartAccountEntryXdr, "base64");
  const signedEntry = await applyWalletAdminSignature(config, prepared, walletSignature);
  const build = () => buildAdminTransaction(config, prepared.method, args, sourceSequence, [smartEntry, signedEntry]);
  const enforcing = await server._simulateTransaction(build(), undefined, "enforce");
  const retvalXdr = enforcing.results?.[0]?.xdr;
  if (enforcing.error || !retvalXdr) {
    throw new Error(`Admin enforcing simulation failed: ${enforcing.error ?? "missing result"}`);
  }
  const retval = scValToNative(xdr.ScVal.fromXDR(retvalXdr, "base64")) as unknown;
  const transaction = await server.prepareTransaction(build());
  transaction.sign(config.transactionSource);
  const submitted = await server.sendTransaction(transaction);
  if (submitted.status === "ERROR") throw new Error(`Admin transaction submission failed: ${submitted.hash}`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(submitted.hash);
    if (result.status === "SUCCESS") return { transactionHash: submitted.hash, retval };
    if (result.status === "FAILED") throw new Error("Admin transaction failed on chain");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Admin settlement unknown for ${submitted.hash}`);
}

export async function prepareCreateContextRuleAuthorization(config: AdminConfig, input: CreateRuleInput) {
  return prepareWalletAdminCall(config, "add_context_rule", createRuleArgs(config, input));
}

export async function prepareRevokeContextRuleAuthorization(config: AdminConfig, contextRuleId: number) {
  return prepareWalletAdminCall(config, "remove_context_rule", [nativeToScVal(contextRuleId, { type: "u32" })]);
}

async function submitAdminCall(
  config: AdminConfig,
  method: string,
  args: xdr.ScVal[],
): Promise<{ transactionHash: string; retval: unknown }> {
  if (!config.adminSigner) throw new Error("Server admin signer is not configured; use wallet authorization");
  const server = new rpc.Server(config.rpcUrl);
  const horizon = new Horizon.Server(config.horizonUrl);
  const loadedAccount = await horizon.loadAccount(config.transactionSource.publicKey());
  const sourceSequence = loadedAccount.sequenceNumber();
  const build = (auth: xdr.SorobanAuthorizationEntry[]) => {
    const func = xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(config.treasuryContract).toScAddress(),
      functionName: method,
      args,
    }));
    return new TransactionBuilder(new Account(config.transactionSource.publicKey(), sourceSequence), {
      fee: "1000000",
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(Operation.invokeHostFunction({ func, auth }))
      .setTimeout(60)
      .build();
  };

  const recording = await server._simulateTransaction(build([]), undefined, "record");
  if (recording.error || !recording.results?.[0]?.auth) {
    throw new Error(`Admin recording simulation failed: ${recording.error ?? "missing auth"}`);
  }
  const payerEntry = recording.results[0].auth
    .map((raw) => xdr.SorobanAuthorizationEntry.fromXDR(raw, "base64"))
    .find((entry) =>
      entry.credentials().switch().name === "sorobanCredentialsAddress" &&
      Address.fromScAddress(entry.credentials().address().address()).toString() === config.treasuryContract
    );
  if (!payerEntry) throw new Error("Admin simulation did not return treasury authorization");

  const auth = await buildDelegatedAuthorizationEntries({
    smartAccountEntry: payerEntry,
    delegate: config.adminSigner,
    contextRuleIds: [config.adminRuleId ?? 0],
    validUntilLedgerSeq: Number(recording.latestLedger) + 12,
    networkPassphrase: config.networkPassphrase,
  });
  const enforcing = await server._simulateTransaction(
    build([auth.smartAccountEntry, auth.delegatedSignerEntry]),
    undefined,
    "enforce",
  );
  const retvalXdr = enforcing.results?.[0]?.xdr;
  if (enforcing.error || !retvalXdr) {
    throw new Error(`Admin enforcing simulation failed: ${enforcing.error ?? "missing result"}`);
  }
  const retval = scValToNative(xdr.ScVal.fromXDR(retvalXdr, "base64")) as unknown;
  const prepared = await server.prepareTransaction(build([auth.smartAccountEntry, auth.delegatedSignerEntry]));
  prepared.sign(config.transactionSource);
  const submitted = await server.sendTransaction(prepared);
  if (submitted.status === "ERROR") {
    const resultCode = submitted.errorResult?.result().switch().name ?? "unknown";
    const diagnosticEvents = submitted.diagnosticEvents?.map((event) => event.toXDR("base64")) ?? [];
    throw new Error(`Admin transaction submission failed: ${JSON.stringify({
      status: submitted.status,
      hash: submitted.hash,
      resultCode,
      diagnosticEvents,
    })}`);
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const transaction = await server.getTransaction(submitted.hash);
    if (transaction.status === "SUCCESS") return { transactionHash: submitted.hash, retval };
    if (transaction.status === "FAILED") throw new Error("Admin transaction failed on chain");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Admin settlement unknown for ${submitted.hash}`);
}

export async function createContextRule(
  config: AdminConfig,
  input: CreateRuleInput,
): Promise<{ contextRuleId: number; transactionHash: string }> {
  const result = await submitAdminCall(config, "add_context_rule", createRuleArgs(config, input));
  const context = result.retval as { id?: unknown };
  if (!Number.isInteger(context.id)) throw new Error("Created rule did not return a context rule ID");
  return { contextRuleId: Number(context.id), transactionHash: result.transactionHash };
}

export async function revokeContextRule(
  config: AdminConfig,
  contextRuleId: number,
): Promise<string> {
  const result = await submitAdminCall(config, "remove_context_rule", [
    nativeToScVal(contextRuleId, { type: "u32" }),
  ]);
  return result.transactionHash;
}

export async function readContractValue(options: {
  rpcUrl: string;
  networkPassphrase: string;
  transactionSource: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}): Promise<unknown> {
  const server = new rpc.Server(options.rpcUrl);
  const transaction = new TransactionBuilder(new Account(options.transactionSource, "0"), {
    fee: "100000",
    networkPassphrase: options.networkPassphrase,
  })
    .addOperation(new Contract(options.contractId).call(options.method, ...options.args))
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result?.retval) {
    throw new Error(`Read simulation failed for ${options.method}`);
  }
  return scValToNative(simulation.result.retval) as unknown;
}
