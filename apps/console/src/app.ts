import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  AgentAllowanceError,
  type AgentAllowance,
  type AllowanceCreateInput,
  type AllowanceRecord,
} from "@agentallowance/sdk";
import { atomicToDecimal } from "@agentallowance/shared";
import { Keypair } from "@stellar/stellar-sdk";

export type ConsoleDeployment = {
  admin?: string;
  token: string;
  assetCode?: string;
  assetDecimals?: number;
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
  publicDemo?: {
    allowanceId?: string;
    successCooldownMs?: number;
  };
  ownerService: {
    profile: (owner: string) => Promise<OwnerProfile>;
    onboard: (owner: string) => Promise<OwnerProfile>;
    scope: (owner: string) => Promise<OwnerConsoleScope>;
  };
  walletAdmin?: {
    prepareCreate: (input: AllowanceCreateInput) => Promise<{ operationId: string; authPreimageXdr: string }>;
    submitCreate: (operationId: string, walletSignature: string) => Promise<AllowanceRecord>;
    prepareRevoke: (allowanceId: string) => Promise<{ operationId: string; authPreimageXdr: string }>;
    submitRevoke: (operationId: string, walletSignature: string) => Promise<AllowanceRecord>;
  };
  auth: {
    username: string;
    password: string;
  };
};

export type OwnerProfile = {
  address: string;
  treasury: string;
  onboarded: boolean;
  deploymentTransaction?: string;
  fundingTransaction?: string;
  fundingError?: string;
};

export type OwnerConsoleScope = {
  agentAllowance: ConsoleApiConfig["agentAllowance"];
  deployment: ConsoleDeployment;
  walletAdmin: NonNullable<ConsoleApiConfig["walletAdmin"]>;
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

function decodeWalletSignature(value: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]{86}==$/.test(normalized)) {
    throw new Error("Wallet signature is not canonical base64");
  }
  const signature = Buffer.from(normalized, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== normalized) {
    throw new Error("Wallet signature is not a 64-byte Ed25519 signature");
  }
  return signature;
}

export function createConsoleApp(config: ConsoleApiConfig): Hono {
  const app = new Hono();
  const challenges = new Map<string, { address: string; message: string; expiresAt: number }>();
  const sessions = new Map<string, { address: string; expiresAt: number }>();
  const publicSuccesses = new Map<string, number>();

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

  app.get("/api/owner/challenge", (context) => {
    const address = context.req.query("address")?.trim() ?? "";
    try { Keypair.fromPublicKey(address); } catch { return context.json({ error: "INVALID_WALLET_ADDRESS" }, 400); }
    const nonce = randomBytes(24).toString("hex");
    const message = `AgentAllowance owner login\nWallet: ${address}\nNonce: ${nonce}\nNetwork: stellar:testnet`;
    challenges.set(nonce, { address, message, expiresAt: Date.now() + 120_000 });
    return context.json({ message, nonce });
  });

  app.post("/api/owner/login", async (context) => {
    const body = await context.req.json<{ nonce: string; address: string; signature: string }>();
    const challenge = challenges.get(body.nonce);
    if (!challenge || challenge.expiresAt < Date.now()) return context.json({ error: "CHALLENGE_EXPIRED" }, 401);
    if (challenge.address !== body.address) return context.json({ error: "CHALLENGE_WALLET_MISMATCH" }, 401);
    try {
      const signature = decodeWalletSignature(body.signature);
      if (!Keypair.fromPublicKey(body.address).verifyMessage(challenge.message, signature)) {
        return context.json({ error: "INVALID_WALLET_SIGNATURE" }, 401);
      }
    } catch { return context.json({ error: "INVALID_WALLET_SIGNATURE" }, 401); }
    challenges.delete(body.nonce);
    const session = randomBytes(32).toString("hex");
    sessions.set(session, { address: body.address, expiresAt: Date.now() + 15 * 60_000 });
    const secure = context.req.header("X-Forwarded-Proto") === "https" || new URL(context.req.url).protocol === "https:"
      ? "; Secure"
      : "";
    context.header("Set-Cookie", `agentallowance_owner=${session}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=900`);
    return context.json({ ok: true, address: body.address });
  });

  const ownerSessionAddress = (cookie: string | undefined): string | undefined => {
    const value = cookie?.split(";").map((item) => item.trim()).find((item) => item.startsWith("agentallowance_owner="))?.slice(21);
    const session = value ? sessions.get(value) : undefined;
    if (!session) return undefined;
    if (session.expiresAt < Date.now()) { sessions.delete(value!); return undefined; }
    return session.address;
  };

  const requireOperator = async (context: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
    if (credentialsMatch(
      context.req.header("Authorization"),
      config.auth.username,
      config.auth.password,
    )) { await next(); return; }
    context.header("WWW-Authenticate", 'Basic realm="AgentAllowance Console", charset="UTF-8"');
    return context.json({ error: "UNAUTHORIZED" }, 401);
  };

  const requireOwner = async (context: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
    if (ownerSessionAddress(context.req.header("Cookie"))) { await next(); return; }
    return context.json({ error: "OWNER_SESSION_REQUIRED" }, 401);
  };

  const currentOwner = (cookie: string | undefined): string => {
    const address = ownerSessionAddress(cookie);
    if (!address) throw new Error("Owner session is missing or expired");
    return address;
  };

  app.use("/api/allowances", requireOperator);
  app.use("/api/allowances/*", requireOperator);
  app.use("/api/owner/profile", requireOwner);
  app.use("/api/owner/onboard", requireOwner);
  app.use("/api/owner/overview", requireOwner);
  app.use("/api/owner/allowances/*", requireOwner);
  app.use("/api/demo/*", requireOwner);
  app.use("/api/attempts/*", requireOwner);

  app.onError((error, context) => {
    if (error instanceof AgentAllowanceError) {
      return context.json({
        error: error.code,
        message: error.message,
        attemptId: error.attemptId,
      }, 400);
    }
    console.error("Unhandled console request error", error);
    return context.json({ error: "INTERNAL_ERROR" }, 500);
  });

  const overview = async (agentAllowance: ConsoleApiConfig["agentAllowance"], deployment: ConsoleDeployment) => {
    const [allowances, balance, currentLedger] = await Promise.all([
      agentAllowance.allowances.list(),
      agentAllowance.treasury.balance(),
      config.getLatestLedger(),
    ]);
    return {
      network: "stellar:testnet",
      treasury: deployment.smartAccount,
      asset: deployment.token,
      assetCode: deployment.assetCode ?? "XLM",
      assetDecimals: deployment.assetDecimals ?? 7,
      balanceAtomic: balance,
      balanceDisplay: atomicToDecimal(balance),
      currentLedger,
      merchant: deployment.merchant,
      facilitatorUrl: config.facilitatorUrl,
      availableSigners: config.availableSigners,
      allowances,
      attempts: agentAllowance.listAttempts(100),
      refreshedAt: new Date().toISOString(),
    };
  };

  app.get("/api/overview", async (context) => {
    return context.json(await overview(config.agentAllowance, config.deployment));
  });

  app.get("/api/owner/profile", async (context) => {
    return context.json(await config.ownerService.profile(currentOwner(context.req.header("Cookie"))));
  });

  app.post("/api/owner/onboard", async (context) => {
    return context.json(await config.ownerService.onboard(currentOwner(context.req.header("Cookie"))), 201);
  });

  app.get("/api/owner/overview", async (context) => {
    const scope = await config.ownerService.scope(currentOwner(context.req.header("Cookie")));
    return context.json(await overview(scope.agentAllowance, scope.deployment));
  });

  app.post("/api/public-demo/run", async (context) => {
    const body = await context.req.json<{ scenario: "success" | "over-limit" | "unapproved-recipient" }>();
    if (!config.publicDemo || !["success", "over-limit", "unapproved-recipient"].includes(body.scenario)) {
      return context.json({ error: "PUBLIC_DEMO_UNAVAILABLE" }, 400);
    }
    const allowance = config.publicDemo.allowanceId
      ? await config.agentAllowance.allowances.get(config.publicDemo.allowanceId)
      : (await config.agentAllowance.allowances.list()).find((item) => item.status === "ACTIVE");
    if (!allowance) return context.json({ error: "NO_ACTIVE_DEMO_ALLOWANCE" }, 409);
    if (body.scenario === "success") {
      const client = context.req.header("CF-Connecting-IP") ?? context.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "local";
      const last = publicSuccesses.get(client) ?? 0;
      const cooldown = config.publicDemo.successCooldownMs ?? 3_600_000;
      if (Date.now() - last < cooldown) return context.json({ error: "PUBLIC_DEMO_COOLDOWN" }, 429);
      publicSuccesses.set(client, Date.now());
    }
    try {
      const url = new URL("/premium", config.demoServiceUrl);
      url.searchParams.set("scenario", body.scenario);
      const response = await config.agentAllowance.fetch(url.toString(), { allowanceId: allowance.allowanceId });
      return context.json({ ok: true, resource: await response.json() });
    } catch (error) {
      if (error instanceof AgentAllowanceError) {
        return context.json({ ok: false, reason: error.code, attemptId: error.attemptId }, 400);
      }
      throw error;
    }
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

  app.post("/api/owner/allowances/prepare", async (context) => {
    const scope = await config.ownerService.scope(currentOwner(context.req.header("Cookie")));
    const body = await context.req.json<{
      label: string; delegatedSigner: string; maxSpendAtomic: string;
      windowSeconds: number; recipient: string; expiresInSeconds: number;
    }>();
    return context.json(await scope.walletAdmin.prepareCreate({
      label: body.label,
      delegatedSigner: body.delegatedSigner,
      maxSpendAtomic: body.maxSpendAtomic,
      windowSeconds: body.windowSeconds,
      allowedRecipients: [body.recipient],
      expiresInSeconds: body.expiresInSeconds,
    }));
  });

  app.post("/api/owner/allowances/submit", async (context) => {
    const scope = await config.ownerService.scope(currentOwner(context.req.header("Cookie")));
    const body = await context.req.json<{ operationId: string; walletSignature: string }>();
    return context.json(await scope.walletAdmin.submitCreate(body.operationId, body.walletSignature), 201);
  });

  app.post("/api/owner/allowances/:id/revoke/prepare", async (context) => {
    const scope = await config.ownerService.scope(currentOwner(context.req.header("Cookie")));
    return context.json(await scope.walletAdmin.prepareRevoke(context.req.param("id")));
  });

  app.post("/api/owner/allowances/revoke/submit", async (context) => {
    const scope = await config.ownerService.scope(currentOwner(context.req.header("Cookie")));
    const body = await context.req.json<{ operationId: string; walletSignature: string }>();
    return context.json(await scope.walletAdmin.submitRevoke(body.operationId, body.walletSignature));
  });

  app.post("/api/demo/run", async (context) => {
    const scope = await config.ownerService.scope(currentOwner(context.req.header("Cookie")));
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
      const response = await scope.agentAllowance.fetch(url.toString(), {
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
    const scope = await config.ownerService.scope(currentOwner(context.req.header("Cookie")));
    return context.json(await scope.agentAllowance.reconcile(context.req.param("id")));
  });

  return app;
}
