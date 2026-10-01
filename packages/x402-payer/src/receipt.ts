import type { PaymentRequirements, SettlementReceipt } from "@agentallowance/shared";

export function assertReceiptMatches(
  receipt: SettlementReceipt,
  requirements: PaymentRequirements,
  expectedPayer: string,
): void {
  if (
    receipt.success !== true ||
    receipt.network !== requirements.network ||
    receipt.asset !== requirements.asset ||
    receipt.amount !== requirements.amount ||
    receipt.payTo !== requirements.payTo ||
    receipt.payer !== expectedPayer ||
    receipt.challengeId !== String(requirements.extra.challengeId ?? "") ||
    !/^[0-9a-f]{64}$/i.test(receipt.transaction)
  ) {
    throw new Error("Settlement receipt does not match the accepted payment requirements");
  }
}
