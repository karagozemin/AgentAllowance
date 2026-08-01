const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { timingSafeEqual } = require("node:crypto");

const publicPort = Number(process.env.PORT || process.env.APP_PORT || "10000");
const internalPort = Number(process.env.RELAYER_INTERNAL_PORT || "8080");
const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error("API_KEY is required");

const configFile = JSON.parse(readFileSync("/app/config/config.json", "utf8"));
const plugin = configFile.plugins.find((candidate) => candidate.id === "x402-facilitator");
if (!plugin?.config) throw new Error("x402-facilitator config is required");
const { handler } = require("/app/plugins/x402-facilitator/index.cjs");

const relayer = spawn("/app/openzeppelin-relayer", [], {
  env: { ...process.env, APP_PORT: String(internalPort) },
  stdio: "inherit",
});
relayer.on("exit", (code, signal) => {
  console.error("OpenZeppelin Relayer exited", { code, signal });
  process.exit(code ?? 1);
});

function authorized(req) {
  const actual = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${apiKey}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function relayerRequest(path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${internalPort}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Relayer HTTP ${response.status}: ${text}`);
  }
  return body?.data ?? body;
}

function useRelayer(relayerId) {
  const getTransaction = ({ transactionId }) =>
    relayerRequest(`/relayers/${encodeURIComponent(relayerId)}/transactions/${encodeURIComponent(transactionId)}`);
  return {
    getRelayer: () => relayerRequest(`/relayers/${encodeURIComponent(relayerId)}`),
    rpc: (payload) => relayerRequest(`/relayers/${encodeURIComponent(relayerId)}/rpc`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    getTransaction,
    sendTransaction: async (payload) => {
      const transaction = await relayerRequest(`/relayers/${encodeURIComponent(relayerId)}/transactions`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return {
        ...transaction,
        wait: async ({ interval = 500, timeout = 60000 } = {}) => {
          const deadline = Date.now() + timeout;
          let current = transaction;
          while (Date.now() < deadline) {
            current = await getTransaction({ transactionId: transaction.id });
            if (!["pending", "sent", "submitted"].includes(current.status)) return current;
            await new Promise((resolve) => setTimeout(resolve, interval));
          }
          throw new Error(`Transaction ${transaction.id} timed out after ${timeout}ms`);
        },
      };
    },
  };
}

const api = {
  useRelayer,
  transactionWait: async (transaction, { interval = 500, timeout = 60000 } = {}) => {
    const deadline = Date.now() + timeout;
    const relayerApi = useRelayer(transaction.relayer_id);
    let current = transaction;
    while (Date.now() < deadline) {
      current = await relayerApi.getTransaction({ transactionId: transaction.id });
      if (!["pending", "sent", "submitted"].includes(current.status)) return current;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Transaction ${transaction.id} timed out after ${timeout}ms`);
  },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) {
        reject(Object.assign(new Error("Request body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": encoded.length,
    "Cache-Control": "no-store",
  });
  res.end(encoded);
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/api/v1/health" && req.method === "GET") {
      const response = await fetch(`http://127.0.0.1:${internalPort}/api/v1/health`).catch(() => null);
      if (!response?.ok) return json(res, 503, { status: "starting" });
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      return res.end("OK");
    }

    const match = req.url?.match(/^\/api\/v1\/plugins\/x402-facilitator\/call(?:\/(supported|verify|settle))?$/);
    if (!match) return json(res, 404, { error: "not_found" });
    if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

    const routeName = match[1] || "";
    if (req.method !== "POST" && !(req.method === "GET" && routeName === "supported")) {
      return json(res, 405, { error: "method_not_allowed" });
    }
    const params = req.method === "POST" ? await readBody(req) : {};
    const result = await handler({
      api,
      kv: {},
      headers: req.headers,
      params,
      route: routeName ? `/${routeName}` : "",
      config: plugin.config,
      method: req.method,
      query: {},
    });
    return json(res, 200, result);
  } catch (error) {
    console.error("Render facilitator adapter error:", error);
    const status = Number(error?.status) || 500;
    return json(res, status, {
      error: error?.code || "internal_error",
      ...(status < 500 ? { message: error?.message || String(error) } : {}),
    });
  }
});

server.listen(publicPort, "0.0.0.0", () => {
  console.log(`Render facilitator adapter listening on 0.0.0.0:${publicPort}`);
});

function shutdown(signal) {
  console.log(`${signal} received; stopping adapter and relayer`);
  server.close(() => process.exit(0));
  relayer.kill("SIGTERM");
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
