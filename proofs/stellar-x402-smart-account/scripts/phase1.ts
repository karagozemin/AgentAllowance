import {
  Account,
  Address,
  authorizeInvocation,
  Keypair,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { readJson, writeJson, writeText } from "./lib/artifacts.js";
import {
  IDENTITIES,
  MAX_TIMEOUT_SECONDS,
  NETWORK_PASSPHRASE,
  PAYMENT_AMOUNT,
  TOKEN,
} from "./lib/config.js";
import { stellar } from "./lib/cli.js";
import { signSmartAccountEntry, transferInvocation } from "./lib/auth.js";
import { readState } from "./lib/state.js";

type Deployment = Awaited<ReturnType<typeof readJson<Record<string, unknown>>>>;

function secret(name: string): string {
  return stellar(["keys", "secret", name], { quiet: true });
}

function authJson(entry: xdr.SorobanAuthorizationEntry): Record<string, unknown> {
  const credentials = entry.credentials();
  return {
    xdr: entry.toXDR("base64"),
    credentialType: credentials.switch().name,
    rootInvocationXdr: entry.rootInvocation().toXDR("base64"),
  };
}

const deployment = await readJson<any>("deployment.json");
await writeJson(deployment.runDirectory, "state-before.json", readState(deployment));
const server = new rpc.Server(deployment.rpcUrl);
const latest = await server.getLatestLedger();
const validUntil = Number(latest.sequence) + Math.max(2, Math.ceil(MAX_TIMEOUT_SECONDS / 10));
const invocation = transferInvocation({
  token: deployment.token,
  from: deployment.smartAccount,
  to: deployment.merchant,
  amount: PAYMENT_AMOUNT,
});
const source = new Account(deployment.feePayer, "0");
const unsignedTx = new TransactionBuilder(source, {
  fee: "1000000",
  networkPassphrase: NETWORK_PASSPHRASE,
})
  .addOperation(
    Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invocation.function().contractFn()),
      auth: [],
    }),
  )
  .setTimeout(MAX_TIMEOUT_SECONDS)
  .build();

const recordResponse = await server._simulateTransaction(unsignedTx, undefined, "record");
await writeJson(deployment.runDirectory, "simulation-record-response.json", recordResponse);
if (recordResponse.error || !recordResponse.results?.[0]?.auth) {
  throw new Error(`Recording simulation failed: ${JSON.stringify(recordResponse)}`);
}

const recordedAuth = recordResponse.results![0]!.auth!.map((item) =>
  xdr.SorobanAuthorizationEntry.fromXDR(item, "base64"),
);
if (recordedAuth.length === 0) throw new Error("Recording simulation returned no auth entry");
const cEntry = recordedAuth.find(
  (entry) => Address.fromScAddress(entry.credentials().address().address()).toString() === deployment.smartAccount,
);
if (!cEntry) throw new Error("Recording simulation did not return the smart-account auth entry");

const delegateKeypair = Keypair.fromSecret(secret(IDENTITIES.delegate));
const signedSmart = await signSmartAccountEntry(
  cEntry,
  validUntil,
  deployment.delegate,
  deployment.ruleId,
);
const delegatedInvocation = new xdr.SorobanAuthorizedInvocation({
  function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(deployment.smartAccount).toScAddress(),
      functionName: "__check_auth",
      args: [xdr.ScVal.scvBytes(signedSmart.authDigest)],
    }),
  ),
  subInvocations: [],
});
const delegatedEntry = await authorizeInvocation({
  signer: delegateKeypair,
  validUntilLedgerSeq: validUntil,
  invocation: delegatedInvocation,
  networkPassphrase: NETWORK_PASSPHRASE,
});

const operation = Operation.invokeHostFunction({
  func: xdr.HostFunction.hostFunctionTypeInvokeContract(invocation.function().contractFn()),
  auth: [signedSmart.entry, delegatedEntry],
});
const finalTx = new TransactionBuilder(source, {
  fee: "1000000",
  networkPassphrase: NETWORK_PASSPHRASE,
})
  .addOperation(operation)
  .setTimeout(MAX_TIMEOUT_SECONDS)
  .build();

const enforcingResponse = await server._simulateTransaction(finalTx, undefined, "enforce");
await writeJson(deployment.runDirectory, "simulation-enforce-response.json", enforcingResponse);
await writeText(deployment.runDirectory, "transaction.xdr", finalTx.toXDR());
await writeText(deployment.runDirectory, "auth-smart-account.xdr", signedSmart.entry.toXDR("base64"));
await writeText(deployment.runDirectory, "auth-delegated-signer.xdr", delegatedEntry.toXDR("base64"));
await writeJson(deployment.runDirectory, "auth-entries.json", [
  authJson(signedSmart.entry),
  authJson(delegatedEntry),
]);
await writeJson(deployment.runDirectory, "phase1.json", {
  validUntil,
  currentLedger: latest.sequence,
  authDigest: signedSmart.authDigest.toString("hex"),
  authEntryCount: 2,
  recordAuthEntryCount: recordedAuth.length,
  enforcingOk: !enforcingResponse.error && !!enforcingResponse.results?.[0],
  token: TOKEN,
  from: deployment.smartAccount,
  to: deployment.merchant,
  amount: PAYMENT_AMOUNT.toString(),
});
console.log(JSON.stringify({
  runDirectory: deployment.runDirectory,
  transactionXdr: `${deployment.runDirectory}/transaction.xdr`,
  enforcing: enforcingResponse,
}, null, 2));
