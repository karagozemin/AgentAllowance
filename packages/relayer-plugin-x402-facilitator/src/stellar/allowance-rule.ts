import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type {
  FacilitatorPolicyManifest,
  ObservedAllowanceRule,
} from "@agentallowance/facilitator-policy";
import type { Relayer } from "@openzeppelin/relayer-sdk";

export async function resolveRecipientPolicyRule(options: {
  relayer: Relayer;
  sourceAddress: string;
  networkPassphrase: string;
  manifest: FacilitatorPolicyManifest;
  contextRuleId: number;
  payer: string;
}): Promise<ObservedAllowanceRule | undefined> {
  const recipientPolicy = options.manifest.recipientPolicy;
  if (!recipientPolicy) return undefined;

  const contract = new Contract(recipientPolicy.contractId);
  const transaction = new TransactionBuilder(new Account(options.sourceAddress, "0"), {
    fee: "100000",
    networkPassphrase: options.networkPassphrase,
  })
    .addOperation(contract.call(
      "get_config",
      nativeToScVal(options.contextRuleId, { type: "u32" }),
      Address.fromString(options.payer).toScVal(),
    ))
    .setTimeout(30)
    .build();

  const response = await options.relayer.rpc({
    method: "simulateTransaction",
    id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    jsonrpc: "2.0",
    params: { transaction: transaction.toXDR() },
  });
  if (response.error) {
    console.error("Recipient policy lookup RPC failed:", response.error);
    return undefined;
  }

  const simulation = response.result as
    | rpc.Api.SimulateTransactionResponse
    | rpc.Api.RawSimulateTransactionResponse;
  if ("error" in simulation && simulation.error) {
    console.error("Recipient policy lookup simulation failed:", simulation.error);
    return undefined;
  }
  const retval = rpc.Api.isSimulationRaw(simulation)
    ? simulation.results?.[0]?.xdr
      ? xdr.ScVal.fromXDR(simulation.results[0].xdr, "base64")
      : undefined
    : "result" in simulation
      ? simulation.result?.retval
      : undefined;
  if (!retval) {
    console.error("Recipient policy lookup returned no value");
    return undefined;
  }

  const config = scValToNative(retval) as { token?: unknown; recipient?: unknown };
  if (typeof config.token !== "string" || typeof config.recipient !== "string") {
    console.error("Recipient policy lookup returned an unexpected shape", {
      tokenType: typeof config.token,
      recipientType: typeof config.recipient,
    });
    return undefined;
  }
  return {
    contextRuleId: options.contextRuleId,
    token: config.token,
    recipient: config.recipient,
  };
}
