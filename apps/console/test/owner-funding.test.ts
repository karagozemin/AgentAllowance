import { describe, expect, test, vi } from "vitest";
import { fundOwnerTreasuryToTarget } from "../src/owner-funding.js";

describe("owner treasury target funding", () => {
  test("funds a new treasury to the configured target", async () => {
    const fund = vi.fn(async () => "funding-transaction");
    const result = await fundOwnerTreasuryToTarget({
      targetBalanceAtomic: 1_000_000n,
      readBalance: async () => "0",
      fund,
    });

    expect(fund).toHaveBeenCalledWith(1_000_000n);
    expect(result).toEqual({
      balanceBeforeAtomic: 0n,
      fundedAtomic: 1_000_000n,
      transactionHash: "funding-transaction",
    });
  });

  test("tops up an existing treasury by only the missing amount", async () => {
    const fund = vi.fn(async () => "top-up-transaction");
    await fundOwnerTreasuryToTarget({
      targetBalanceAtomic: 1_000_000n,
      readBalance: async () => "250000",
      fund,
    });

    expect(fund).toHaveBeenCalledWith(750_000n);
  });

  test("does not transfer when the treasury already meets the target", async () => {
    const fund = vi.fn(async () => "unexpected");
    const result = await fundOwnerTreasuryToTarget({
      targetBalanceAtomic: 1_000_000n,
      readBalance: async () => "5000000",
      fund,
    });

    expect(fund).not.toHaveBeenCalled();
    expect(result.fundedAtomic).toBe(0n);
    expect(result.transactionHash).toBeUndefined();
  });

  test("rejects malformed balance responses", async () => {
    await expect(fundOwnerTreasuryToTarget({
      targetBalanceAtomic: 1_000_000n,
      readBalance: async () => "1.0",
      fund: vi.fn(),
    })).rejects.toThrow("Treasury balance must contain atomic units");
  });
});
