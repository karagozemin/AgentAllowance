import {
  contractInstanceLedgerKey,
  extractContractWasmHash,
  type FacilitatorPolicyManifest,
} from "@agentallowance/facilitator-policy";
import type { Relayer } from "@openzeppelin/relayer-sdk";

type LedgerEntriesResult = {
  entries?: Array<{ xdr?: string }>;
};

export async function resolvePolicyWasmHashes(
  relayer: Relayer,
  manifest: FacilitatorPolicyManifest,
  payer?: string,
): Promise<Readonly<Record<string, string>>> {
  const hashes: Record<string, string> = {};

  const contracts = [
    ...manifest.adapters.map((adapter) => adapter.contractId),
    ...(manifest.recipientPolicy ? [manifest.recipientPolicy.contractId] : []),
    ...(manifest.smartAccountWasmHash && payer ? [payer] : []),
  ];

  for (const contractId of contracts) {
    const response = await relayer.rpc({
      method: "getLedgerEntries",
      id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
      jsonrpc: "2.0",
      params: { keys: [contractInstanceLedgerKey(contractId)] },
    });
    if (response.error) continue;

    const entryXdr = (response.result as LedgerEntriesResult | undefined)?.entries?.[0]?.xdr;
    if (!entryXdr) continue;
    try {
      hashes[contractId] = extractContractWasmHash(entryXdr);
    } catch {
      // An absent or malformed instance remains an identity mismatch in the validator.
    }
  }

  return hashes;
}
