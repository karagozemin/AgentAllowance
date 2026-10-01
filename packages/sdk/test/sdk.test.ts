import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import { AgentAllowance, SqliteEvidenceStore, type AllowanceRecord } from "../src/index.js";

const contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const merchant = Keypair.random().publicKey();
const delegate = Keypair.random();
const source = Keypair.random();
const admin = Keypair.random();

function record(): AllowanceRecord {
  return {
    allowanceId: "1",
    label: "research-agent",
    network: "stellar:testnet",
    treasuryContract: contract,
    assetContract: contract,
    delegatedSigner: delegate.publicKey(),
    maxSpendAtomic: "1000000",
    spentAtomic: "200000",
    windowLedgers: 17280,
    allowedRecipients: [merchant],
    validUntilLedger: 1000,
    contextRuleId: 1,
    status: "ACTIVE",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function sdk() {
  return new AgentAllowance({
    network: "stellar:testnet",
    rpcUrl: "http://127.0.0.1:8000",
    assetContract: contract,
    treasuryContract: contract,
    spendingPolicy: contract,
    recipientPolicy: contract,
    facilitatorUrl: "http://127.0.0.1:8787",
    transactionSource: source,
    adminSigner: admin,
    delegatedSigners: { [delegate.publicKey()]: delegate },
    store: new SqliteEvidenceStore(":memory:"),
  });
}

describe("AgentAllowance SDK", () => {
  test("returns an ALLOW decision with exact remaining budget", () => {
    const decision = sdk().preflight({
      scheme: "exact",
      network: "stellar:testnet",
      amount: "100000",
      payTo: merchant,
      maxTimeoutSeconds: 30,
      asset: contract,
      extra: { areFeesSponsored: true },
    }, record(), 500);
    expect(decision).toEqual({ allowed: true, remainingAtomic: "700000" });

    const exact = sdk().preflight({
      scheme: "exact",
      network: "stellar:testnet",
      amount: "800000",
      payTo: merchant,
      maxTimeoutSeconds: 30,
      asset: contract,
      extra: { areFeesSponsored: true },
    }, record(), 500);
    expect(exact).toEqual({ allowed: true, remainingAtomic: "0" });
  });

  test("normalizes recipient, budget, and expiry blocks", () => {
    const instance = sdk();
    const base = {
      scheme: "exact" as const,
      network: "stellar:testnet" as const,
      amount: "100000",
      payTo: merchant,
      maxTimeoutSeconds: 30,
      asset: contract,
      extra: { areFeesSponsored: true as const },
    };
    expect(instance.preflight({ ...base, payTo: source.publicKey() }, record(), 500))
      .toMatchObject({ allowed: false, reason: "RECIPIENT_NOT_ALLOWED" });
    expect(instance.preflight({ ...base, amount: "900000" }, record(), 500))
      .toMatchObject({ allowed: false, reason: "BUDGET_EXCEEDED" });
    expect(instance.preflight(base, record(), 1001))
      .toMatchObject({ allowed: false, reason: "ALLOWANCE_EXPIRED" });
  });

  test("normalizes network, asset, revoked, and inactive blocks", () => {
    const instance = sdk();
    const base = {
      scheme: "exact" as const,
      network: "stellar:testnet" as const,
      amount: "100000",
      payTo: merchant,
      maxTimeoutSeconds: 30,
      asset: contract,
      extra: { areFeesSponsored: true as const },
    };
    expect(instance.preflight({ ...base, network: "stellar:pubnet" }, record(), 500))
      .toMatchObject({ allowed: false, reason: "NETWORK_MISMATCH" });
    expect(instance.preflight({ ...base, asset: "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4" }, record(), 500))
      .toMatchObject({ allowed: false, reason: "ASSET_NOT_ALLOWED" });
    expect(instance.preflight(base, { ...record(), status: "REVOKED" }, 500))
      .toMatchObject({ allowed: false, reason: "ALLOWANCE_REVOKED" });
    expect(instance.preflight(base, { ...record(), status: "ERROR" }, 500))
      .toMatchObject({ allowed: false, reason: "ALLOWANCE_NOT_ACTIVE" });
  });

  test("persists allowance records in SQLite", () => {
    const store = new SqliteEvidenceStore(":memory:");
    store.putAllowance(record());
    expect(store.getAllowance("1")).toEqual(record());
  });
});
