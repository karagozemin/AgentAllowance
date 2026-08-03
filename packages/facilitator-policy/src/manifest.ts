export const OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2 =
  "openzeppelin-stellar-accounts/spending-limit@0.7.2" as const;

export type OpenZeppelinSpendingLimitAdapter = {
  kind: typeof OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2;
  contractId: string;
  expectedWasmHash?: string;
  required: boolean;
};

export type PolicyAdapter = OpenZeppelinSpendingLimitAdapter;

export type RecipientPolicyBinding = {
  contractId: string;
  expectedWasmHash: string;
};

export type FacilitatorPolicyManifest = {
  id: string;
  network: "stellar:testnet" | "stellar:pubnet";
  smartAccount?: string;
  smartAccountWasmHash?: string;
  expectedRuleId?: number;
  allowedRuleIds?: number[];
  recipientPolicy?: RecipientPolicyBinding;
  adapters: PolicyAdapter[];
};

export function assertProductionManifest(manifest: FacilitatorPolicyManifest): void {
  if (!manifest.id.trim()) throw new Error("Policy manifest ID is required");
  if (manifest.smartAccount && !/^C[A-Z2-7]{55}$/.test(manifest.smartAccount)) {
    throw new Error("Policy manifest smartAccount must be a Stellar C-account payer");
  }
  if (manifest.smartAccountWasmHash && !/^[0-9a-f]{64}$/i.test(manifest.smartAccountWasmHash)) {
    throw new Error("Policy manifest smartAccountWasmHash must be a SHA-256 hash");
  }
  if (!manifest.smartAccount && !manifest.smartAccountWasmHash) {
    throw new Error("Policy manifest must pin a smart-account address or WASM hash");
  }
  if (
    manifest.expectedRuleId !== undefined &&
    (!Number.isSafeInteger(manifest.expectedRuleId) || manifest.expectedRuleId < 0)
  ) {
    throw new Error("Policy manifest expectedRuleId must be a non-negative integer");
  }
  if (manifest.allowedRuleIds) {
    if (
      manifest.allowedRuleIds.length === 0 ||
      manifest.allowedRuleIds.some((id) => !Number.isSafeInteger(id) || id < 0) ||
      new Set(manifest.allowedRuleIds).size !== manifest.allowedRuleIds.length
    ) {
      throw new Error("Policy manifest allowedRuleIds must contain unique non-negative integers");
    }
  }
  if (manifest.expectedRuleId === undefined) {
    const recipient = manifest.recipientPolicy;
    if (!recipient || !/^C[A-Z2-7]{55}$/.test(recipient.contractId)) {
      throw new Error("Dynamic policy manifest must pin a recipient-policy contract");
    }
    if (!/^[0-9a-f]{64}$/i.test(recipient.expectedWasmHash)) {
      throw new Error("Dynamic policy manifest must pin the recipient-policy WASM hash");
    }
  }
  if (manifest.adapters.length !== 1) {
    throw new Error("MVP policy manifest requires exactly one spending-limit adapter");
  }

  const identities = new Set<string>();
  for (const adapter of manifest.adapters) {
    if (adapter.kind !== OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2) {
      throw new Error(`Unsupported policy adapter kind: ${String(adapter.kind)}`);
    }
    if (!/^C[A-Z2-7]{55}$/.test(adapter.contractId)) {
      throw new Error(`Invalid Stellar policy contract ID: ${adapter.contractId}`);
    }
    if (!adapter.required) {
      throw new Error("OpenZeppelin spending-limit event must be required in the MVP");
    }
    if (!adapter.expectedWasmHash) {
      throw new Error(`Production adapter ${adapter.contractId} must pin expectedWasmHash`);
    }
    if (!/^[0-9a-f]{64}$/i.test(adapter.expectedWasmHash)) {
      throw new Error(`Invalid WASM hash for ${adapter.contractId}`);
    }
    const identity = `${adapter.kind}:${adapter.contractId}`;
    if (identities.has(identity)) throw new Error(`Duplicate policy adapter ${identity}`);
    identities.add(identity);
  }
}
