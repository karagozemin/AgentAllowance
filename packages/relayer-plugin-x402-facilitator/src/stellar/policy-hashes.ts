import {
  contractInstanceLedgerKey,
  extractContractWasmHash,
  type FacilitatorPolicyManifest,
} from "@agentallowance/facilitator-policy";
import type { Relayer } from "@openzeppelin/relayer-sdk";

type LedgerEntriesResult = {
  entries?: Array<{ key?: string; xdr?: string }>;
};

export async function resolvePolicyWasmHashes(
  relayer: Relayer,
  manifest: FacilitatorPolicyManifest,
  payer?: string,
): Promise<Readonly<Record<string, string>>> {
  const hashes: Record<string, string> = {};

  const contracts = [...new Set([
    ...manifest.adapters.map((adapter) => adapter.contractId),
    ...(manifest.recipientPolicy ? [manifest.recipientPolicy.contractId] : []),
    ...(manifest.smartAccountWasmHash && payer ? [payer] : []),
  ])];
  const keys = contracts.map((contractId) => contractInstanceLedgerKey(contractId));
  const contractsByKey = new Map(keys.map((key, index) => [key, contracts[index]!]));

  const response = await relayer.rpc({
    method: "getLedgerEntries",
    id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    jsonrpc: "2.0",
    params: { keys },
  });
  if (response.error) return hashes;

  const entries = (response.result as LedgerEntriesResult | undefined)?.entries ?? [];
  for (const [index, entry] of entries.entries()) {
    const contractId = entry.key
      ? contractsByKey.get(entry.key)
      : entries.length === contracts.length
        ? contracts[index]
        : undefined;
    const entryXdr = entry.xdr;
    if (!contractId) continue;
    if (!entryXdr) continue;
    try {
      hashes[contractId] = extractContractWasmHash(entryXdr);
    } catch {
      // An absent or malformed instance remains an identity mismatch in the validator.
    }
  }

  return hashes;
}
