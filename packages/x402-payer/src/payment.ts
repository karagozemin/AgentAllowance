import {
  Account,
  Address,
  Keypair,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { buildDelegatedAuthorizationEntries, transferInvocation } from "@agentallowance/stellar-smart-account-auth";
import type { PaymentRequirements, StellarPaymentPayload } from "@agentallowance/shared";

export type SmartAccountPayerConfig = {
  rpcUrl: string;
  networkPassphrase: string;
  smartAccount: string;
  delegatedSigner: Keypair;
  contextRuleId: number;
  transactionSource: string;
  maxTransactionFeeStroops?: string;
};

export type BuiltPayment = {
  paymentPayload: StellarPaymentPayload;
  transactionXdr: string;
  authDigest: string;
  validUntilLedger: number;
  simulation: unknown;
};

export async function buildSmartAccountPayment(
  config: SmartAccountPayerConfig,
  requirements: PaymentRequirements,
): Promise<BuiltPayment> {
  if (requirements.network !== "stellar:testnet" && requirements.network !== "stellar:pubnet") {
    throw new Error("Unsupported Stellar network");
  }
  const amount = BigInt(requirements.amount);
  if (amount <= 0n) throw new Error("Payment amount must be positive");

  const server = new rpc.Server(config.rpcUrl);
  const latest = await server.getLatestLedger();
  const validUntilLedger = Number(latest.sequence) + Math.max(2, Math.ceil(requirements.maxTimeoutSeconds / 5));
  const invocation = transferInvocation({
    token: requirements.asset,
    from: config.smartAccount,
    to: requirements.payTo,
    amount,
  });
  const source = new Account(config.transactionSource, "0");
  const build = (auth: xdr.SorobanAuthorizationEntry[]) => new TransactionBuilder(source, {
    fee: config.maxTransactionFeeStroops ?? "1000000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invocation.function().contractFn()),
      auth,
    }))
    .setTimeout(requirements.maxTimeoutSeconds)
    .build();

  const recording = await server._simulateTransaction(build([]), undefined, "record");
  if (recording.error || !recording.results?.[0]?.auth) {
    throw new Error(`Recording simulation failed: ${recording.error ?? "missing auth entries"}`);
  }
  const recorded = recording.results[0].auth.map((raw) =>
    xdr.SorobanAuthorizationEntry.fromXDR(raw, "base64")
  );
  const payerEntry = recorded.find((entry) =>
    entry.credentials().switch().name === "sorobanCredentialsAddress" &&
    Address.fromScAddress(entry.credentials().address().address()).toString() === config.smartAccount
  );
  if (!payerEntry) throw new Error("Simulation did not return the smart-account authorization entry");

  const authorization = await buildDelegatedAuthorizationEntries({
    smartAccountEntry: payerEntry,
    delegate: config.delegatedSigner,
    contextRuleIds: [config.contextRuleId],
    validUntilLedgerSeq: validUntilLedger,
    networkPassphrase: config.networkPassphrase,
  });
  const transaction = build([authorization.smartAccountEntry, authorization.delegatedSignerEntry]);
  const enforcing = await server._simulateTransaction(transaction, undefined, "enforce");
  if (enforcing.error || !enforcing.results?.[0]) {
    throw new Error(`Enforcing simulation failed: ${enforcing.error ?? "missing result"}`);
  }

  const transactionXdr = transaction.toXDR();
  return {
    paymentPayload: {
      x402Version: 2,
      accepted: requirements,
      payload: { transaction: transactionXdr },
    },
    transactionXdr,
    authDigest: authorization.authDigest.toString("hex"),
    validUntilLedger,
    simulation: enforcing,
  };
}
