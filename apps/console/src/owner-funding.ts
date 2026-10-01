export type OwnerFundingResult = {
  balanceBeforeAtomic: bigint;
  fundedAtomic: bigint;
  transactionHash?: string;
};

type OwnerFundingOptions = {
  targetBalanceAtomic: bigint;
  readBalance: () => Promise<string>;
  fund: (amount: bigint) => Promise<string | undefined>;
};

export async function fundOwnerTreasuryToTarget(
  options: OwnerFundingOptions,
): Promise<OwnerFundingResult> {
  const rawBalance = await options.readBalance();
  if (!/^\d+$/u.test(rawBalance)) throw new Error("Treasury balance must contain atomic units");
  const balanceBeforeAtomic = BigInt(rawBalance);
  const fundedAtomic = options.targetBalanceAtomic > balanceBeforeAtomic
    ? options.targetBalanceAtomic - balanceBeforeAtomic
    : 0n;
  const transactionHash = fundedAtomic > 0n ? await options.fund(fundedAtomic) : undefined;
  return { balanceBeforeAtomic, fundedAtomic, transactionHash };
}
