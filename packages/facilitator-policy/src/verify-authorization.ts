import {
  Address,
  Operation,
  scValToNative,
  Transaction,
  xdr,
} from "@stellar/stellar-sdk";
import { validateDelegatedAuthorizationEntries } from "@agentallowance/stellar-smart-account-auth";

export type DelegatedTransactionValidationResult =
  | {
      valid: true;
      payer: string;
      delegate: string;
      contextRuleId: number;
      authEntries: xdr.SorobanAuthorizationEntry[];
    }
  | { valid: false; reason: string; detail: string };

export async function validateDelegatedPaymentTransaction(options: {
  transactionXdr: string;
  networkPassphrase: string;
  expected: { token: string; from: string; to: string; amount: bigint; contextRuleId: number };
}): Promise<DelegatedTransactionValidationResult> {
  let transaction: Transaction;
  try {
    transaction = new Transaction(options.transactionXdr, options.networkPassphrase);
  } catch {
    return { valid: false, reason: "AUTH_STRUCTURE_INVALID", detail: "Malformed transaction XDR" };
  }
  if (transaction.signatures.length !== 0 || transaction.operations.length !== 1) {
    return {
      valid: false,
      reason: "AUTH_STRUCTURE_INVALID",
      detail: "Payment must contain one operation and no envelope signatures",
    };
  }

  const operation = transaction.operations[0];
  if (operation?.type !== "invokeHostFunction") {
    return { valid: false, reason: "AUTH_STRUCTURE_INVALID", detail: "Expected invokeHostFunction" };
  }
  const invoke = operation as Operation.InvokeHostFunction;
  if (invoke.func.switch().name !== "hostFunctionTypeInvokeContract") {
    return { valid: false, reason: "AUTH_STRUCTURE_INVALID", detail: "Expected contract invocation" };
  }
  const call = invoke.func.invokeContract();
  const args = call.args();
  if (
    Address.fromScAddress(call.contractAddress()).toString() !== options.expected.token ||
    call.functionName().toString() !== "transfer" ||
    args.length !== 3 ||
    Address.fromScVal(args[0]!).toString() !== options.expected.from ||
    Address.fromScVal(args[1]!).toString() !== options.expected.to ||
    (scValToNative(args[2]!) as bigint) !== options.expected.amount
  ) {
    return { valid: false, reason: "AUTH_STRUCTURE_INVALID", detail: "Transfer invocation mismatch" };
  }

  const authEntries = invoke.auth ?? [];
  const auth = await validateDelegatedAuthorizationEntries({
    entries: authEntries,
    transfer: options.expected,
    networkPassphrase: options.networkPassphrase,
    expectedRuleId: options.expected.contextRuleId,
  });
  if (!auth.valid) return auth;

  return {
    valid: true,
    payer: auth.payer,
    delegate: auth.delegate,
    contextRuleId: auth.contextRuleIds[0]!,
    authEntries,
  };
}
