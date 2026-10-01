import {
  Account,
  Address,
  Contract,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scvSortedMap,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { buildDelegatedAuthorizationEntries } from "@agentallowance/stellar-smart-account-auth";

export type AdminConfig = {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  treasuryContract: string;
  assetContract: string;
  spendingPolicy: string;
  recipientPolicy: string;
  adminSigner: Keypair;
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

async function submitAdminCall(
  config: AdminConfig,
  method: string,
  args: xdr.ScVal[],
): Promise<{ transactionHash: string; retval: unknown }> {
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
  const result = await submitAdminCall(config, "add_context_rule", [
    variant("CallContract", Address.fromString(config.assetContract).toScVal()),
    xdr.ScVal.scvString(input.label.slice(0, 16)),
    xdr.ScVal.scvU32(input.validUntilLedger),
    xdr.ScVal.scvVec([variant("Delegated", Address.fromString(input.delegatedSigner).toScVal())]),
    policies,
  ]);
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
