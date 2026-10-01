import { describe, expect, test } from "vitest";
import { PendingOwnerOperations } from "../src/owner-operations.js";

type Operation = { owner: string; kind: "create" | "revoke"; expiresAt: number; payload: string };

describe("owner-scoped pending wallet operations", () => {
  test("allows only the wallet that prepared an operation to consume it", () => {
    const store = new PendingOwnerOperations<Operation>();
    store.put("operation-a", { owner: "wallet-a", kind: "create", expiresAt: 2_000, payload: "auth" });
    expect(() => store.take("operation-a", "create", "wallet-b", 1_000)).toThrow("belongs to another wallet");
    expect(() => store.take("operation-a", "create", "wallet-a", 1_000)).toThrow("missing");
  });

  test("rejects wrong operation kinds and expired authorization", () => {
    const store = new PendingOwnerOperations<Operation>();
    store.put("wrong-kind", { owner: "wallet-a", kind: "create", expiresAt: 2_000, payload: "auth" });
    expect(() => store.take("wrong-kind", "revoke", "wallet-a", 1_000)).toThrow();
    store.put("expired", { owner: "wallet-a", kind: "revoke", expiresAt: 900, payload: "auth" });
    expect(() => store.take("expired", "revoke", "wallet-a", 1_000)).toThrow("expired");
  });

  test("returns the exact operation once", () => {
    const store = new PendingOwnerOperations<Operation>();
    const operation = { owner: "wallet-a", kind: "create" as const, expiresAt: 2_000, payload: "auth" };
    store.put("operation-a", operation);
    expect(store.take("operation-a", "create", "wallet-a", 1_000)).toEqual(operation);
    expect(() => store.take("operation-a", "create", "wallet-a", 1_000)).toThrow();
  });
});
