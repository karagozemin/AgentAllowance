import { describe, expect, test } from "vitest";
import { assertReceiptMatches } from "../src/index.js";

const requirements = {
  scheme: "exact" as const,
  network: "stellar:testnet" as const,
  amount: "100000",
  payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  maxTimeoutSeconds: 30,
  asset: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  extra: { areFeesSponsored: true as const, challengeId: "challenge-1" },
};
const receipt = {
  success: true as const,
  transaction: "11".repeat(32),
  network: "stellar:testnet" as const,
  payer: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  amount: "100000",
  asset: requirements.asset,
  payTo: requirements.payTo,
  challengeId: "challenge-1",
};

describe("receipt validation", () => {
  test("accepts an exact receipt", () => {
    expect(() => assertReceiptMatches(receipt, requirements, receipt.payer)).not.toThrow();
  });

  test("rejects an altered recipient or amount", () => {
    expect(() => assertReceiptMatches({ ...receipt, payTo: receipt.payer }, requirements, receipt.payer))
      .toThrow(/does not match/);
    expect(() => assertReceiptMatches({ ...receipt, amount: "99999" }, requirements, receipt.payer))
      .toThrow(/does not match/);
  });
});
