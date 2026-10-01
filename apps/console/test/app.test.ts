import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, test, vi } from "vitest";
import { AgentAllowanceError, type AllowanceCreateInput } from "@agentallowance/sdk";
import type { AllowanceRecord, PaymentAttempt } from "@agentallowance/shared";
import { createConsoleApp, type ConsoleApiConfig } from "../src/app.js";

const treasury = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const token = "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4";
const signer = Keypair.random().publicKey();
const merchant = Keypair.random().publicKey();

function allowance(): AllowanceRecord {
  return {
    allowanceId: "2",
    label: "research-agent",
    network: "stellar:testnet",
    treasuryContract: treasury,
    assetContract: token,
    delegatedSigner: signer,
    maxSpendAtomic: "500000",
    spentAtomic: "100000",
    windowLedgers: 720,
    allowedRecipients: [merchant],
    validUntilLedger: 2000,
    contextRuleId: 2,
    status: "ACTIVE",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function attempt(): PaymentAttempt {
  return {
    attemptId: "attempt-1",
    allowanceId: "2",
    url: "http://demo.test/premium",
    requestReference: "challenge-1",
    challengeHash: "aa",
    amountAtomic: "100000",
    payTo: merchant,
    assetContract: token,
    state: "BLOCKED",
    decision: "BLOCK",
    reasonCode: "BUDGET_EXCEEDED",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function setup() {
  const current = allowance();
  const create = vi.fn(async (input: AllowanceCreateInput) => ({
    ...current,
    label: input.label,
    delegatedSigner: input.delegatedSigner,
    maxSpendAtomic: input.maxSpendAtomic,
    allowedRecipients: input.allowedRecipients,
  }));
  const revoke = vi.fn(async () => ({ ...current, status: "REVOKED" as const }));
  const payFetch = vi.fn(async () => Response.json({ access: "PAID_AND_UNLOCKED" }));
  const reconcile = vi.fn(async () => attempt());
  const agentAllowance = {
    allowances: {
      create,
      get: vi.fn(async () => current),
      list: vi.fn(async () => [current]),
      revoke,
    },
    treasury: { balance: vi.fn(async () => "1200000") },
    listAttempts: vi.fn(() => [attempt()]),
    fetch: payFetch,
    reconcile,
  } satisfies ConsoleApiConfig["agentAllowance"];
  const app = createConsoleApp({
    agentAllowance,
    deployment: { token, smartAccount: treasury, merchant },
    facilitatorUrl: "https://facilitator.test/call",
    availableSigners: [signer],
    demoServiceUrl: "http://demo.test",
    getLatestLedger: async () => 1500,
  });
  return { app, create, revoke, payFetch, reconcile };
}

describe("console API", () => {
  test("returns treasury, allowance and evidence state without signer secrets", async () => {
    const response = await setup().app.request("/api/overview");
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({
      treasury,
      asset: token,
      balanceAtomic: "1200000",
      balanceDisplay: "0.12",
      currentLedger: 1500,
      availableSigners: [signer],
      allowances: [{ allowanceId: "2" }],
      attempts: [{ attemptId: "attempt-1" }],
    });
    expect(raw).not.toContain("secret");
  });

  test("maps the create form to one exact recipient", async () => {
    const { app, create } = setup();
    const response = await app.request("/api/allowances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "data-agent",
        delegatedSigner: signer,
        maxSpendAtomic: "250000",
        windowSeconds: 3600,
        recipient: merchant,
        expiresInSeconds: 7200,
      }),
    });
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ allowedRecipients: [merchant] }));
  });

  test("requires exact revoke confirmation", async () => {
    const { app, revoke } = setup();
    const response = await app.request("/api/allowances/2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowanceId: "2", delegatedSigner: Keypair.random().publicKey() }),
    });
    expect(response.status).toBe(400);
    expect(revoke).not.toHaveBeenCalled();
  });

  test("runs only supported demo scenarios and normalizes policy blocks", async () => {
    const { app, payFetch } = setup();
    payFetch.mockRejectedValueOnce(new AgentAllowanceError("RECIPIENT_NOT_ALLOWED", { attemptId: "attempt-2" }));
    const blocked = await app.request("/api/demo/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowanceId: "2", scenario: "unapproved-recipient" }),
    });
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toEqual({
      ok: false,
      reason: "RECIPIENT_NOT_ALLOWED",
      attemptId: "attempt-2",
    });

    const invalid = await app.request("/api/demo/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowanceId: "2", scenario: "arbitrary" }),
    });
    expect(invalid.status).toBe(400);
  });

  test("exposes reconciliation for uncertain attempts", async () => {
    const { app, reconcile } = setup();
    expect((await app.request("/api/attempts/attempt-1/reconcile")).status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith("attempt-1");
  });
});
