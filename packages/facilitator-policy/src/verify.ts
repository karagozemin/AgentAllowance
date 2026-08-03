import { Networks, xdr } from "@stellar/stellar-sdk";
import type { FacilitatorPolicyManifest } from "./manifest.js";
import { validatePolicyAwareSimulationEvents } from "./events.js";
import { validateDelegatedPaymentTransaction } from "./verify-authorization.js";

export type PolicyAwareVerifyReason =
  | "invalid_x402_version"
  | "invalid_scheme"
  | "invalid_network"
  | "invalid_exact_stellar_payload_wrong_asset"
  | "invalid_exact_stellar_payload_wrong_recipient"
  | "invalid_exact_stellar_payload_wrong_amount"
  | "invalid_exact_stellar_payload_auth_structure"
  | "invalid_exact_stellar_payload_policy_event_unapproved"
  | "invalid_exact_stellar_payload_policy_event_malformed"
  | "invalid_exact_stellar_payload_policy_event_context_mismatch"
  | "invalid_exact_stellar_payload_policy_manifest_mismatch"
  | "invalid_exact_stellar_payload_unexpected_balance_changes";

export type X402PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  asset: string;
};

export type PolicyAwareVerifyResult =
  | { isValid: true; payer: string; delegate: string; contextRuleId: number }
  | { isValid: false; payer?: string; invalidReason: PolicyAwareVerifyReason; detail: string };

export type ObservedAllowanceRule = {
  contextRuleId: number;
  token: string;
  recipient: string;
};

function mapEventReason(reason: string): PolicyAwareVerifyReason {
  if (reason === "POLICY_EVENT_UNAPPROVED") {
    return "invalid_exact_stellar_payload_policy_event_unapproved";
  }
  if (reason === "POLICY_EVENT_CONTEXT_MISMATCH") {
    return "invalid_exact_stellar_payload_policy_event_context_mismatch";
  }
  if (reason === "FACILITATOR_POLICY_MANIFEST_MISMATCH") {
    return "invalid_exact_stellar_payload_policy_manifest_mismatch";
  }
  if (reason.startsWith("POLICY_EVENT_")) {
    return "invalid_exact_stellar_payload_policy_event_malformed";
  }
  return "invalid_exact_stellar_payload_unexpected_balance_changes";
}

export async function verifyPolicyAwarePayment(options: {
  x402Version: number;
  transactionXdr: string;
  paymentRequirements: X402PaymentRequirements;
  simulationEvents: Array<xdr.DiagnosticEvent | string>;
  manifest: FacilitatorPolicyManifest;
  observedWasmHashes?: Readonly<Record<string, string>>;
  resolveAllowanceRule?: (
    contextRuleId: number,
    payer: string,
  ) => Promise<ObservedAllowanceRule | undefined>;
}): Promise<PolicyAwareVerifyResult> {
  const requirements = options.paymentRequirements;
  if (options.x402Version !== 2) {
    return { isValid: false, invalidReason: "invalid_x402_version", detail: "Only x402 v2 is supported" };
  }
  if (requirements.scheme !== "exact") {
    return { isValid: false, invalidReason: "invalid_scheme", detail: "Only exact payments are supported" };
  }
  if (requirements.network !== options.manifest.network) {
    return { isValid: false, invalidReason: "invalid_network", detail: "Manifest network mismatch" };
  }
  if (!/^\d+$/.test(requirements.amount) || BigInt(requirements.amount) <= 0n) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_wrong_amount",
      detail: "Amount must be a positive atomic-unit integer",
    };
  }
  const payer = options.manifest.smartAccount;
  if (!payer) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_policy_manifest_mismatch",
      detail: "Delegated profile requires a pinned smart account",
    };
  }

  const expected = {
    token: requirements.asset,
    from: payer,
    to: requirements.payTo,
    amount: BigInt(requirements.amount),
    contextRuleId: options.manifest.expectedRuleId,
  };
  const auth = await validateDelegatedPaymentTransaction({
    transactionXdr: options.transactionXdr,
    networkPassphrase:
      requirements.network === "stellar:pubnet" ? Networks.PUBLIC : Networks.TESTNET,
    expected,
  });
  if (!auth.valid) {
    return {
      isValid: false,
      payer,
      invalidReason: "invalid_exact_stellar_payload_auth_structure",
      detail: `${auth.reason}: ${auth.detail}`,
    };
  }

  if (
    options.manifest.allowedRuleIds &&
    !options.manifest.allowedRuleIds.includes(auth.contextRuleId)
  ) {
    return {
      isValid: false,
      payer,
      invalidReason: "invalid_exact_stellar_payload_policy_manifest_mismatch",
      detail: `Signed rule ${auth.contextRuleId} is not allowed by the manifest`,
    };
  }

  if (options.manifest.expectedRuleId === undefined) {
    const recipientPolicy = options.manifest.recipientPolicy;
    const observedHash = recipientPolicy
      ? options.observedWasmHashes?.[recipientPolicy.contractId]
      : undefined;
    if (
      !recipientPolicy ||
      !observedHash ||
      observedHash.toLowerCase() !== recipientPolicy.expectedWasmHash.toLowerCase()
    ) {
      return {
        isValid: false,
        payer,
        invalidReason: "invalid_exact_stellar_payload_policy_manifest_mismatch",
        detail: "Recipient-policy code identity is not manifest-pinned",
      };
    }

    const observedRule = await options.resolveAllowanceRule?.(auth.contextRuleId, payer);
    if (
      !observedRule ||
      observedRule.contextRuleId !== auth.contextRuleId ||
      observedRule.token !== requirements.asset ||
      observedRule.recipient !== requirements.payTo
    ) {
      return {
        isValid: false,
        payer,
        invalidReason: "invalid_exact_stellar_payload_policy_manifest_mismatch",
        detail: "Selected rule is not installed with the pinned recipient policy and payment terms",
      };
    }
  }

  const eventExpected = { ...expected, contextRuleId: auth.contextRuleId };

  const events = validatePolicyAwareSimulationEvents({
    diagnosticEvents: options.simulationEvents,
    expected: eventExpected,
    manifest: options.manifest,
    observedWasmHashes: options.observedWasmHashes,
  });
  if (!events.valid) {
    return {
      isValid: false,
      payer,
      invalidReason: mapEventReason(events.reason),
      detail: events.detail,
    };
  }

  return {
    isValid: true,
    payer,
    delegate: auth.delegate,
    contextRuleId: auth.contextRuleId,
  };
}
