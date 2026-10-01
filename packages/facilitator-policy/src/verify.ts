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
  if (options.manifest.expectedRuleId === undefined) {
    return {
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_policy_manifest_mismatch",
      detail: "Delegated profile requires an expected rule ID",
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

  const events = validatePolicyAwareSimulationEvents({
    diagnosticEvents: options.simulationEvents,
    expected,
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
