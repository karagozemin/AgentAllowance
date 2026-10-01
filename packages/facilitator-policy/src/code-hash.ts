import { Address, xdr } from "@stellar/stellar-sdk";

export function contractInstanceLedgerKey(contractId: string): string {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  ).toXDR("base64");
}

export function extractContractWasmHash(ledgerEntryDataXdr: string): string {
  const data = xdr.LedgerEntryData.fromXDR(ledgerEntryDataXdr, "base64");
  if (data.switch().name !== "contractData") {
    throw new Error("Ledger entry is not contract data");
  }
  const value = data.contractData().val();
  if (value.switch().name !== "scvContractInstance") {
    throw new Error("Contract data is not a contract instance");
  }
  const executable = value.instance().executable();
  if (executable.switch().name !== "contractExecutableWasm") {
    throw new Error("Contract instance is not WASM-backed");
  }
  return executable.wasmHash().toString("hex");
}
