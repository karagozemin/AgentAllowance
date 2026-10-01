import { describe, expect, test } from "vitest";
import { selectTransactionFeeStroops } from "../src/payment.js";

describe("selectTransactionFeeStroops", () => {
  test("adds ten percent headroom and a base-fee buffer", () => {
    expect(selectTransactionFeeStroops("3184458", "10000000")).toBe("3503004");
  });

  test("rejects a simulated resource fee above the configured cap", () => {
    expect(() => selectTransactionFeeStroops("9500000", "10000000"))
      .toThrow("exceeds configured transaction fee cap");
  });

  test("rejects missing or malformed simulation fees", () => {
    expect(() => selectTransactionFeeStroops(undefined)).toThrow("valid minimum resource fee");
    expect(() => selectTransactionFeeStroops("3.14")).toThrow("valid minimum resource fee");
  });
});
