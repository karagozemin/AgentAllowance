import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  Account,
  Address,
  Keypair,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import {
  buildDelegatedAuthorizationEntries,
  transferInvocation,
} from "@agentallowance/stellar-smart-account-auth";
import {
  IDENTITIES,
  MAX_TIMEOUT_SECONDS,
  NETWORK_PASSPHRASE,
  RPC_URL,
  selectedScenario,
} from "./config.js";
import {
  createAttemptDirectory,
  latestRunDirectory,
  readRunJson,
  stellar,
  writeJson,
  writeText,
} from "./runtime.js";

type Deployment = {
  token: string;
  smartAccount: string;
  merchant: string;
  delegate: string;
  feePayer: string;
  unapprovedRecipient: string;
  allowanceRuleId: number;
  paymentAmount: string;
  spendingLimit: string;
};

const deployment = await readRunJson<Deployment>("deployment.json");
const runDirectory = await latestRunDirectory();
const scenario = selectedScenario();
const directory = await createAttemptDirectory(runDirectory, scenario);
const paymentAmount = process.env.PAYMENT_AMOUNT_OVERRIDE
  ? BigInt(process.env.PAYMENT_AMOUNT_OVERRIDE)
  : scenario === "over-limit"
    ? BigInt(deployment.spendingLimit) + 1n
    : BigInt(deployment.paymentAmount);
const recipient = process.env.PAYMENT_RECIPIENT_OVERRIDE
  ?? (scenario === "unapproved-recipient" ? deployment.unapprovedRecipient : deployment.merchant);
const server = new rpc.Server(RPC_URL);
const latest = await server.getLatestLedger();
const validUntil = Number(latest.sequence) + Math.max(2, Math.ceil(MAX_TIMEOUT_SECONDS / 5));
const invocation = transferInvocation({
  token: deployment.token,
  from: deployment.smartAccount,
  to: recipient,
  amount: paymentAmount,
});
const source = new Account(deployment.feePayer, "0");
const recordingTx = new TransactionBuilder(source, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
  .addOperation(Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invocation.function().contractFn()),
    auth: [],
  }))
  .setTimeout(MAX_TIMEOUT_SECONDS)
  .build();

const recording = await server._simulateTransaction(recordingTx, undefined, "record");
await writeJson(directory, "simulation-record-response.json", recording);
if (recording.error || !recording.results?.[0]?.auth) throw new Error("Recording simulation failed");
const recorded = recording.results[0].auth.map((raw) => xdr.SorobanAuthorizationEntry.fromXDR(raw, "base64"));
const payerEntry = recorded.find(
  (entry) => Address.fromScAddress(entry.credentials().address().address()).toString() === deployment.smartAccount,
);
if (!payerEntry) throw new Error("Recording simulation did not return the smart-account entry");

const delegateSecret = stellar(["keys", "secret", IDENTITIES.delegate], true);
const auth = await buildDelegatedAuthorizationEntries({
  smartAccountEntry: payerEntry,
  delegate: Keypair.fromSecret(delegateSecret),
  contextRuleIds: [deployment.allowanceRuleId],
  validUntilLedgerSeq: validUntil,
  networkPassphrase: NETWORK_PASSPHRASE,
});
const finalTx = new TransactionBuilder(source, { fee: "1000000", networkPassphrase: NETWORK_PASSPHRASE })
  .addOperation(Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invocation.function().contractFn()),
    auth: [auth.smartAccountEntry, auth.delegatedSignerEntry],
  }))
  .setTimeout(MAX_TIMEOUT_SECONDS)
  .build();
const enforcing = await server._simulateTransaction(finalTx, undefined, "enforce");
await writeJson(directory, "simulation-enforce-response.json", enforcing);
await writeText(directory, "transaction.xdr", finalTx.toXDR());
await writeJson(directory, "authorization.json", {
  scenario,
  runDirectory,
  attemptDirectory: directory,
  payment: {
    amount: paymentAmount.toString(),
    recipient,
    token: deployment.token,
    payer: deployment.smartAccount,
  },
  validUntil,
  currentLedger: latest.sequence,
  authDigest: auth.authDigest.toString("hex"),
  enforcingOk: !enforcing.error && Boolean(enforcing.results?.[0]),
  entries: [auth.smartAccountEntry, auth.delegatedSignerEntry].map((entry) => ({
    address: Address.fromScAddress(entry.credentials().address().address()).toString(),
    rootInvocationXdr: entry.rootInvocation().toXDR("base64"),
    xdr: entry.toXDR("base64"),
  })),
});
console.log(await readFile(path.join(directory, "authorization.json"), "utf8"));
