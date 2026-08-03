import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, test, vi } from "vitest";
import { AgentAllowanceError, type AllowanceCreateInput } from "@agentallowance/sdk";
import type { AllowanceRecord, PaymentAttempt } from "@agentallowance/shared";
import { createConsoleApp, type ConsoleApiConfig } from "../src/app.js";

const treasury = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const token = "CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4";
const signer = Keypair.random().publicKey();
const merchant = Keypair.random().publicKey();
const owner = Keypair.random();
const authorization = `Basic ${Buffer.from("operator:test-password").toString("base64")}`;

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
  const prepareCreate = vi.fn(async () => ({ operationId: "op-create", authEntryXdr: "unsigned" }));
  const submitCreate = vi.fn(async () => current);
  const prepareRevoke = vi.fn(async () => ({ operationId: "op-revoke", authEntryXdr: "unsigned" }));
  const submitRevoke = vi.fn(async () => ({ ...current, status: "REVOKED" as const }));
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
  const walletAdmin = { prepareCreate, submitCreate, prepareRevoke, submitRevoke };
  const profile = vi.fn(async (address: string) => ({ address, treasury, onboarded: true }));
  const ownerService = {
    profile,
    onboard: vi.fn(async (address: string) => ({ address, treasury, onboarded: true })),
    scope: vi.fn(async () => ({
      agentAllowance,
      deployment: { token, smartAccount: treasury, merchant },
      walletAdmin,
    })),
  };
  const app = createConsoleApp({
    agentAllowance,
    deployment: { token, smartAccount: treasury, merchant },
    facilitatorUrl: "https://facilitator.test/call",
    availableSigners: [signer],
    demoServiceUrl: "http://demo.test",
    getLatestLedger: async () => 1500,
    publicDemo: { allowanceId: "2", successCooldownMs: 60_000 },
    walletAdmin,
    ownerService,
    auth: { username: "operator", password: "test-password" },
  });
  return { app, create, revoke, payFetch, reconcile, prepareCreate, submitCreate, profile };
}

async function ownerCookie(app: ReturnType<typeof createConsoleApp>, wallet = owner): Promise<string> {
  const challengeResponse = await app.request(`/api/owner/challenge?address=${wallet.publicKey()}`);
  const challenge = await challengeResponse.json() as { nonce: string; message: string };
  const response = await app.request("/api/owner/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nonce: challenge.nonce,
      address: wallet.publicKey(),
      signature: wallet.sign(Buffer.from(challenge.message)).toString("base64"),
    }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

describe("console API", () => {
  test("keeps dashboard and wallet-login page public", async () => {
    const { app } = setup();
    app.get("/", (context) => context.text("console"));
    app.get("/operator", (context) => context.text("operator"));
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/api/overview")).status).toBe(200);
    const missing = await app.request("/operator");
    expect(missing.status).toBe(200);
    expect((await app.request("/operator", {
      headers: { Authorization: "Basic malformed" },
    })).status).toBe(200);
    expect((await app.request("/operator", {
      headers: { Authorization: authorization },
    })).status).toBe(200);
  });

  test("rejects unauthenticated state changes before calling the SDK", async () => {
    const { app, create, payFetch } = setup();
    expect((await app.request("/api/allowances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).status).toBe(401);
    expect((await app.request("/api/demo/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
    expect(payFetch).not.toHaveBeenCalled();
  });

  test("returns treasury, allowance and evidence state without signer secrets", async () => {
    const response = await setup().app.request("/api/overview");
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(JSON.parse(raw)).toMatchObject({
      treasury,
      asset: token,
      assetCode: "XLM",
      assetDecimals: 7,
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
      headers: { "Content-Type": "application/json", Authorization: authorization },
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
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({ allowanceId: "2", delegatedSigner: Keypair.random().publicKey() }),
    });
    expect(response.status).toBe(400);
    expect(revoke).not.toHaveBeenCalled();
  });

  test("keeps wallet preparation and submission behind authenticated owner state", async () => {
    const { app, prepareCreate, submitCreate } = setup();
    expect((await app.request("/api/owner/allowances/prepare", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/owner/allowances/prepare", {
      method: "POST", headers: { Authorization: authorization },
    })).status).toBe(401);
    const cookie = await ownerCookie(app);
    const prepared = await app.request("/api/owner/allowances/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        label: "data-agent", delegatedSigner: signer, maxSpendAtomic: "250000",
        windowSeconds: 3600, recipient: merchant, expiresInSeconds: 7200,
      }),
    });
    expect(prepared.status).toBe(200);
    expect(prepareCreate).toHaveBeenCalled();
    const submitted = await app.request("/api/owner/allowances/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ operationId: "op-create", signedAuthEntryXdr: "signed" }),
    });
    expect(submitted.status).toBe(201);
    expect(submitCreate).toHaveBeenCalledWith("op-create", "signed");
  });

  test("accepts any valid wallet and keeps each owner address in its own session", async () => {
    const { app, profile } = setup();
    const second = Keypair.random();
    const firstCookie = await ownerCookie(app, owner);
    const secondCookie = await ownerCookie(app, second);
    expect((await app.request("/api/owner/profile", { headers: { Cookie: firstCookie } })).status).toBe(200);
    expect((await app.request("/api/owner/profile", { headers: { Cookie: secondCookie } })).status).toBe(200);
    expect(profile.mock.calls.map(([address]) => address)).toEqual([owner.publicKey(), second.publicKey()]);
  });

  test("binds a login challenge to the wallet that requested it", async () => {
    const { app } = setup();
    const other = Keypair.random();
    const challenge = await (await app.request(`/api/owner/challenge?address=${owner.publicKey()}`)).json() as {
      nonce: string; message: string;
    };
    const response = await app.request("/api/owner/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nonce: challenge.nonce,
        address: other.publicKey(),
        signature: other.sign(Buffer.from(challenge.message)).toString("base64"),
      }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "CHALLENGE_WALLET_MISMATCH" });
  });

  test("runs only supported demo scenarios and normalizes policy blocks", async () => {
    const { app, payFetch } = setup();
    const cookie = await ownerCookie(app);
    payFetch.mockRejectedValueOnce(new AgentAllowanceError("RECIPIENT_NOT_ALLOWED", { attemptId: "attempt-2" }));
    const blocked = await app.request("/api/demo/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
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
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ allowanceId: "2", scenario: "arbitrary" }),
    });
    expect(invalid.status).toBe(400);
  });

  test("runs only fixed public demo scenarios and rate-limits successful settlement", async () => {
    const { app, payFetch } = setup();
    expect((await app.request("/api/public-demo/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "success" }),
    })).status).toBe(200);
    expect((await app.request("/api/public-demo/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "success" }),
    })).status).toBe(429);
    expect((await app.request("/api/public-demo/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "arbitrary" }),
    })).status).toBe(400);
    expect(payFetch).toHaveBeenCalledTimes(1);
  });

  test("exposes reconciliation for uncertain attempts", async () => {
    const { app, reconcile } = setup();
    const cookie = await ownerCookie(app);
    expect((await app.request("/api/attempts/attempt-1/reconcile", {
      headers: { Cookie: cookie },
    })).status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith("attempt-1");
  });
});
