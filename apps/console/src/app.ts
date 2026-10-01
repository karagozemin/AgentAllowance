import { createHash, timingSafeEqual } from "node:crypto";
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
  auth: {
    username: string;
    password: string;
  };
};

function credentialsMatch(authorization: string | undefined, username: string, password: string): boolean {
  if (!authorization?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const supplied = `${decoded.slice(0, separator)}\0${decoded.slice(separator + 1)}`;
  const expected = `${username}\0${password}`;
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(expected).digest(),
  );
}

export function createConsoleApp(config: ConsoleApiConfig): Hono {
  const app = new Hono();

  app.use("*", async (context, next) => {
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Referrer-Policy", "no-referrer");
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    context.header("Cache-Control", "no-store");
    await next();
  });

  app.get("/health", (context) => context.json({ status: "ok", network: "stellar:testnet" }));

  const requireOperator = async (context: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
    if (!credentialsMatch(
      context.req.header("Authorization"),
      config.auth.username,
      config.auth.password,
    )) {
      context.header("WWW-Authenticate", 'Basic realm="AgentAllowance Console", charset="UTF-8"');
      return context.json({ error: "UNAUTHORIZED" }, 401);
    }
    await next();
  };

  app.use("/operator", requireOperator);
  app.use("/api/allowances", requireOperator);
  app.use("/api/allowances/*", requireOperator);
  app.use("/api/demo/*", requireOperator);
  app.use("/api/attempts/*", requireOperator);

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
