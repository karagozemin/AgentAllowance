import { describe, expect, test } from "vitest";
import {
  atomicToDecimal,
  decimalToAtomic,
  decodePaymentSignature,
  encodePaymentSignature,
  parsePaymentRequired,
  type StellarPaymentPayload,
} from "../src/index.js";

const accepted = {
  scheme: "exact" as const,
  network: "stellar:testnet" as const,
  amount: "100000",
  payTo: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  maxTimeoutSeconds: 30,
  asset: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  extra: { areFeesSponsored: true as const, challengeId: "challenge-1" },
};

describe("shared protocol primitives", () => {
  test("converts Stellar decimal and atomic amounts without floating point", () => {
    expect(decimalToAtomic("0.01")).toBe(100000n);
    expect(atomicToDecimal(100000n)).toBe("0.01");
  });

  test("parses the strict Stellar x402 v2 profile", () => {
    expect(parsePaymentRequired({
      x402Version: 2,
      resource: { url: "http://localhost/premium", description: "demo", mimeType: "application/json" },
      accepts: [accepted],
    }).accepts[0]).toEqual(accepted);
  });

  test("round-trips PAYMENT-SIGNATURE", () => {
    const payload: StellarPaymentPayload = {
      x402Version: 2,
      accepted,
      payload: { transaction: "AAAA" },
    };
    expect(decodePaymentSignature(encodePaymentSignature(payload))).toEqual(payload);
  });
});
