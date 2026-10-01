import {
  Address,
  authorizeEntry,
  hash,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { contextRuleIdsScVal } from "./authorization.js";

export type AuthValidationReason =
  | "AUTH_STRUCTURE_INVALID"
  | "AUTH_ENTRY_UNSIGNED"
  | "AUTH_PAYER_MISMATCH"
  | "AUTH_DELEGATE_MISMATCH"
  | "AUTH_RULE_SELECTION_INVALID"
  | "AUTH_DIGEST_MISMATCH"
  | "AUTH_EXPIRATION_MISMATCH";

export type AuthValidationResult =
  | { valid: true; payer: string; delegate: string; contextRuleIds: number[] }
  | { valid: false; reason: AuthValidationReason; detail: string };

function invalid(reason: AuthValidationReason, detail: string): AuthValidationResult {
  return { valid: false, reason, detail };
}

function contractFunction(entry: xdr.SorobanAuthorizationEntry): xdr.InvokeContractArgs | null {
  const root = entry.rootInvocation();
  if (root.subInvocations().length !== 0) return null;
  const fn = root.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") return null;
  return fn.contractFn();
}

function addressOf(entry: xdr.SorobanAuthorizationEntry): string | null {
  const credentials = entry.credentials();
  if (credentials.switch().name !== "sorobanCredentialsAddress") return null;
  return Address.fromScAddress(credentials.address().address()).toString();
}

function readAuthPayload(signature: xdr.ScVal): { delegate: string; ruleIds: number[] } | null {
  if (signature.switch().name !== "scvMap") return null;
  const entries = signature.map() ?? [];
  if (entries.length !== 2) return null;

  const byName = new Map<string, xdr.ScVal>();
  for (const entry of entries) {
    if (entry.key().switch().name !== "scvSymbol") return null;
    byName.set(entry.key().sym().toString(), entry.val());
  }

  const ruleIdsValue = byName.get("context_rule_ids");
  const signersValue = byName.get("signers");
  if (!ruleIdsValue || !signersValue || ruleIdsValue.switch().name !== "scvVec") return null;

  const ruleIds: number[] = [];
  for (const value of ruleIdsValue.vec() ?? []) {
    if (value.switch().name !== "scvU32") return null;
    ruleIds.push(value.u32());
  }
  if (ruleIds.length === 0) return null;

  if (signersValue.switch().name !== "scvMap") return null;
  const signers = signersValue.map() ?? [];
  if (signers.length !== 1) return null;
  const signer = signers[0];
  if (!signer || signer.val().switch().name !== "scvBytes" || signer.val().bytes().length !== 0) {
    return null;
  }
  if (signer.key().switch().name !== "scvVec") return null;
  const signerParts = signer.key().vec() ?? [];
  if (
    signerParts.length !== 2 ||
    signerParts[0]?.switch().name !== "scvSymbol" ||
    signerParts[0].sym().toString() !== "Delegated" ||
    signerParts[1]?.switch().name !== "scvAddress"
  ) {
    return null;
  }

  return {
    delegate: Address.fromScVal(signerParts[1]).toString(),
    ruleIds,
  };
}

export async function validateDelegatedAuthorizationEntries(options: {
  entries: xdr.SorobanAuthorizationEntry[];
  transfer: { token: string; from: string; to: string; amount: bigint };
  networkPassphrase: string;
  expectedRuleId?: number;
}): Promise<AuthValidationResult> {
  if (options.entries.length !== 2) {
    return invalid("AUTH_STRUCTURE_INVALID", "Delegated profile requires exactly two entries");
  }

  const payerEntry = options.entries.find((entry) => addressOf(entry) === options.transfer.from);
  if (!payerEntry) return invalid("AUTH_PAYER_MISMATCH", "No payer C-account entry was found");
  const delegateEntry = options.entries.find((entry) => entry !== payerEntry);
  if (!delegateEntry) return invalid("AUTH_STRUCTURE_INVALID", "Delegated entry is missing");

  const payerCredentials = payerEntry.credentials().address();
  const delegateCredentials = delegateEntry.credentials();
  if (delegateCredentials.switch().name !== "sorobanCredentialsAddress") {
    return invalid("AUTH_STRUCTURE_INVALID", "Both entries must use address credentials");
  }
  if (
    payerCredentials.signature().switch().name === "scvVoid" ||
    delegateCredentials.address().signature().switch().name === "scvVoid"
  ) {
    return invalid("AUTH_ENTRY_UNSIGNED", "Both authorization entries must be signed");
  }
  if (
    payerCredentials.signatureExpirationLedger() !==
    delegateCredentials.address().signatureExpirationLedger()
  ) {
    return invalid("AUTH_EXPIRATION_MISMATCH", "Authorization expirations must match");
  }

  const payerFn = contractFunction(payerEntry);
  if (!payerFn || payerFn.functionName().toString() !== "transfer") {
    return invalid("AUTH_STRUCTURE_INVALID", "Payer root must be a transfer with no subinvocations");
  }
  const payerArgs = payerFn.args();
  if (
    Address.fromScAddress(payerFn.contractAddress()).toString() !== options.transfer.token ||
    payerArgs.length !== 3 ||
    Address.fromScVal(payerArgs[0]!).toString() !== options.transfer.from ||
    Address.fromScVal(payerArgs[1]!).toString() !== options.transfer.to ||
    (scValToNative(payerArgs[2]!) as bigint) !== options.transfer.amount
  ) {
    return invalid("AUTH_PAYER_MISMATCH", "Payer root does not match the required transfer");
  }

  const payload = readAuthPayload(payerCredentials.signature());
  if (!payload) return invalid("AUTH_STRUCTURE_INVALID", "Malformed OpenZeppelin AuthPayload");
  if (options.expectedRuleId !== undefined && payload.ruleIds[0] !== options.expectedRuleId) {
    return invalid("AUTH_RULE_SELECTION_INVALID", "Selected rule does not match facilitator profile");
  }

  const delegateAddress = addressOf(delegateEntry);
  if (delegateAddress !== payload.delegate) {
    return invalid("AUTH_DELEGATE_MISMATCH", "Delegated entry address differs from AuthPayload signer");
  }
  const delegateFn = contractFunction(delegateEntry);
  if (
    !delegateFn ||
    Address.fromScAddress(delegateFn.contractAddress()).toString() !== options.transfer.from ||
    delegateFn.functionName().toString() !== "__check_auth" ||
    delegateFn.args().length !== 1 ||
    delegateFn.args()[0]?.switch().name !== "scvBytes" ||
    delegateFn.args()[0]!.bytes().length !== 32
  ) {
    return invalid("AUTH_STRUCTURE_INVALID", "Delegated root must be payer.__check_auth(bytes32)");
  }

  let expectedDigest: Buffer | undefined;
  await authorizeEntry(
    payerEntry,
    async (_preimage, signaturePayload) => {
      expectedDigest = hash(
        Buffer.concat([signaturePayload, contextRuleIdsScVal(payload.ruleIds).toXDR("raw")]),
      );
      return { signatureScVal: payerCredentials.signature() };
    },
    payerCredentials.signatureExpirationLedger(),
    options.networkPassphrase,
  );

  if (!expectedDigest || !expectedDigest.equals(delegateFn.args()[0]!.bytes())) {
    return invalid("AUTH_DIGEST_MISMATCH", "Delegated __check_auth digest is not bound to rule selection");
  }

  return {
    valid: true,
    payer: options.transfer.from,
    delegate: payload.delegate,
    contextRuleIds: payload.ruleIds,
  };
}
