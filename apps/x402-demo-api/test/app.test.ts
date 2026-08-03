import { afterEach, describe, expect, test, vi } from "vitest";
import { encodePaymentSignature } from "@agentallowance/shared";
import { Address } from "@stellar/stellar-sdk";
import { createApp } from "../src/app.js";
import { DemoPaymentStore } from "../src/store.js";

const contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const merchant = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const payer = contract;

function app() {
  return createApp({
    network: "stellar:testnet",
    rpcUrl: "https://rpc.test",
    assetContract: contract,
    treasuryContract: payer,
    merchant,
    unapprovedRecipient: "GBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYRE",
    amountAtomic: "100000",
    overLimitAmountAtomic: "1000001",
    facilitatorUrl: "https://facilitator.test/call",
    publicBaseUrl: "http://demo.test",
    store: new DemoPaymentStore(":memory:"),
    getLatestLedger: async () => 123456,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("x402 demo API", () => {
  test("returns a strict payment challenge", async () => {
    const response = await app().request("/premium");
    expect(response.status).toBe(402);
    const body = await response.json() as { x402Version: number; accepts: Array<{ amount: string }> };
    expect(body.x402Version).toBe(2);
    expect(body.accepts[0]?.amount).toBe("100000");
  });

  test("settles once, unlocks real ledger data, and reuses the receipt", async () => {
    const service = app();
    const challengeResponse = await service.request("/premium");
    const challenge = await challengeResponse.json() as {
      accepts: [Parameters<typeof encodePaymentSignature>[0]["accepted"]];
    };
    const signature = encodePaymentSignature({
      x402Version: 2,
      accepted: challenge.accepts[0],
      payload: { transaction: "AAAA" },
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/verify")) return Response.json({ isValid: true, payer });
      if (url.endsWith("/settle")) {
        return Response.json({ success: true, transaction: "11".repeat(32), network: "stellar:testnet", payer });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const paid = await service.request("/premium", { headers: { "PAYMENT-SIGNATURE": signature } });
    expect(paid.status).toBe(200);
    expect(paid.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    await expect(paid.json()).resolves.toMatchObject({ access: "PAID_AND_UNLOCKED", latestLedger: 123456 });

    const replay = await service.request("/premium", { headers: { "PAYMENT-SIGNATURE": signature } });
    expect(replay.status).toBe(200);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/settle"))).toHaveLength(1);
  });

  test("accepts another policy-approved smart-account payer", async () => {
    const service = app();
    const anotherPayer = Address.contract(Buffer.alloc(32, 9)).toString();
    const challenge = await (await service.request("/premium")).json() as {
      accepts: [Parameters<typeof encodePaymentSignature>[0]["accepted"]];
    };
    const signature = encodePaymentSignature({
      x402Version: 2,
      accepted: challenge.accepts[0],
      payload: { transaction: "AAAA" },
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/verify")) {
        return Response.json({ isValid: true, payer: anotherPayer });
      }
      if (String(input).endsWith("/settle")) {
        return Response.json({ success: true, transaction: "33".repeat(32), network: "stellar:testnet", payer: anotherPayer });
      }
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await service.request("/premium", { headers: { "PAYMENT-SIGNATURE": signature } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ treasury: anotherPayer });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("rejects a facilitator response without a C-account payer", async () => {
    const service = app();
    const challenge = await (await service.request("/premium")).json() as {
      accepts: [Parameters<typeof encodePaymentSignature>[0]["accepted"]];
    };
    const signature = encodePaymentSignature({
      x402Version: 2,
      accepted: challenge.accepts[0],
      payload: { transaction: "AAAA" },
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ isValid: true, payer: merchant })));
    const response = await service.request("/premium", { headers: { "PAYMENT-SIGNATURE": signature } });
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ reason: "invalid_smart_account_payer" });
  });

  test("atomically allows only one in-flight settlement for a challenge", async () => {
    const service = app();
    const challenge = await (await service.request("/premium")).json() as {
      accepts: [Parameters<typeof encodePaymentSignature>[0]["accepted"]];
    };
    const signature = encodePaymentSignature({
      x402Version: 2,
      accepted: challenge.accepts[0],
      payload: { transaction: "AAAA" },
    });
    let releaseVerify!: () => void;
    const verifyGate = new Promise<void>((resolve) => { releaseVerify = resolve; });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/verify")) {
        await verifyGate;
        return Response.json({ isValid: true, payer });
      }
      if (url.endsWith("/settle")) {
        return Response.json({ success: true, transaction: "22".repeat(32), payer });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = service.request("/premium", { headers: { "PAYMENT-SIGNATURE": signature } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const duplicate = await service.request("/premium", { headers: { "PAYMENT-SIGNATURE": signature } });
    expect(duplicate.status).toBe(202);
    releaseVerify();
    expect((await first).status).toBe(200);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/settle"))).toHaveLength(1);
  });

  test("keeps an ambiguous settlement claim pending for reconciliation", async () => {
    const service = app();
    const challenge = await (await service.request("/premium")).json() as {
      accepts: [Parameters<typeof encodePaymentSignature>[0]["accepted"]];
    };
    const challengeId = String(challenge.accepts[0].extra.challengeId);
    const signature = encodePaymentSignature({
      x402Version: 2,
      accepted: challenge.accepts[0],
      payload: { transaction: "AAAA" },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/verify")) return Response.json({ isValid: true, payer });
      throw new Error("connection closed after submission");
    }));

    expect((await service.request("/premium", { headers: { "PAYMENT-SIGNATURE": signature } })).status).toBe(502);
    const retry = await service.request("/premium", { headers: { "PAYMENT-SIGNATURE": signature } });
    expect(retry.status).toBe(202);
    const status = await service.request(`/payments/${challengeId}`);
    expect(status.status).toBe(202);
  });
});
