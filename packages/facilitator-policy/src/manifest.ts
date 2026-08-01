export const OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2 =
  "openzeppelin-stellar-accounts/spending-limit@0.7.2" as const;

export type OpenZeppelinSpendingLimitAdapter = {
  kind: typeof OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2;
  contractId: string;
  expectedWasmHash?: string;
  required: boolean;
};

export type PolicyAdapter = OpenZeppelinSpendingLimitAdapter;

export type FacilitatorPolicyManifest = {
  id: string;
  network: "stellar:testnet" | "stellar:pubnet";
  smartAccount?: string;
  expectedRuleId?: number;
  adapters: PolicyAdapter[];
};

export function assertProductionManifest(manifest: FacilitatorPolicyManifest): void {
  if (!manifest.id.trim()) throw new Error("Policy manifest ID is required");
  if (manifest.adapters.length === 0) throw new Error("At least one policy adapter is required");

  const identities = new Set<string>();
  for (const adapter of manifest.adapters) {
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
