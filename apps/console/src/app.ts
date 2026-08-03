import { Hono } from "hono";
import {
  AgentAllowanceError,
  type AgentAllowance,
  type AllowanceCreateInput,
} from "@agentallowance/sdk";
import { atomicToDecimal } from "@agentallowance/shared";

export type ConsoleDeployment = {
  token: string;
  smartAccount: string;
  merchant: string;
};

export type ConsoleApiConfig = {
  agentAllowance: Pick<AgentAllowance, "allowances" | "treasury" | "listAttempts" | "fetch" | "reconcile">;
  deployment: ConsoleDeployment;
  facilitatorUrl: string;
  availableSigners: string[];
  demoServiceUrl: string;
  getLatestLedger: () => Promise<number>;
};

export function createConsoleApp(config: ConsoleApiConfig): Hono {
  const app = new Hono();

  app.onError((error, context) => {
    if (error instanceof AgentAllowanceError) {
      return context.json({
        error: error.code,
        message: error.message,
        attemptId: error.attemptId,
      }, 400);
    }
    console.error(error instanceof Error ? error.message : "Unknown server error");
    return context.json({ error: "INTERNAL_ERROR" }, 500);
  });

  app.get("/api/overview", async (context) => {
    const [allowances, balance, currentLedger] = await Promise.all([
      config.agentAllowance.allowances.list(),
      config.agentAllowance.treasury.balance(),
      config.getLatestLedger(),
    ]);
    return context.json({
      network: "stellar:testnet",
      treasury: config.deployment.smartAccount,
      asset: config.deployment.token,
      balanceAtomic: balance,
      balanceDisplay: atomicToDecimal(balance),
      currentLedger,
      merchant: config.deployment.merchant,
      facilitatorUrl: config.facilitatorUrl,
      availableSigners: config.availableSigners,
      allowances,
      attempts: config.agentAllowance.listAttempts(100),
      refreshedAt: new Date().toISOString(),
    });
  });

  app.post("/api/allowances", async (context) => {
    const body = await context.req.json<{
      label: string;
      delegatedSigner: string;
      maxSpendAtomic: string;
      windowSeconds: number;
      recipient: string;
      expiresInSeconds: number;
    }>();
    const input: AllowanceCreateInput = {
      label: body.label,
      delegatedSigner: body.delegatedSigner,
      maxSpendAtomic: body.maxSpendAtomic,
      windowSeconds: body.windowSeconds,
      allowedRecipients: [body.recipient],
      expiresInSeconds: body.expiresInSeconds,
    };
    return context.json(await config.agentAllowance.allowances.create(input), 201);
  });

  app.post("/api/allowances/:id/revoke", async (context) => {
    const current = await config.agentAllowance.allowances.get(context.req.param("id"));
    const body = await context.req.json<{ allowanceId: string; delegatedSigner: string }>();
    if (body.allowanceId !== current.allowanceId || body.delegatedSigner !== current.delegatedSigner) {
      return context.json({ error: "CONFIRMATION_MISMATCH" }, 400);
    }
    return context.json(await config.agentAllowance.allowances.revoke(current.allowanceId));
  });

  app.post("/api/demo/run", async (context) => {
    const body = await context.req.json<{
      allowanceId: string;
      scenario: "success" | "over-limit" | "unapproved-recipient";
    }>();
    if (!["success", "over-limit", "unapproved-recipient"].includes(body.scenario)) {
      return context.json({ error: "INVALID_SCENARIO" }, 400);
    }
    try {
      const url = new URL("/premium", config.demoServiceUrl);
      url.searchParams.set("scenario", body.scenario);
      const response = await config.agentAllowance.fetch(url.toString(), {
        allowanceId: body.allowanceId,
      });
      return context.json({ ok: true, resource: await response.json() });
    } catch (error) {
      if (error instanceof AgentAllowanceError) {
        return context.json({ ok: false, reason: error.code, attemptId: error.attemptId }, 400);
      }
      throw error;
    }
  });

  app.get("/api/attempts/:id/reconcile", async (context) => {
    return context.json(await config.agentAllowance.reconcile(context.req.param("id")));
  });

  return app;
}
