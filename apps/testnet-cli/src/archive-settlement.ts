import { execFileSync } from "node:child_process";
import path from "node:path";
import { RPC_URL } from "./config.js";
import {
  latestAttemptDirectory,
  readAttemptJson,
  workspaceRoot,
  writeJson,
  writeText,
} from "./runtime.js";

type SettleResponse = {
  requestedAt: string;
  httpStatus: number;
  body: {
    success?: boolean;
    transaction?: string;
  };
};

const settlement = await readAttemptJson<SettleResponse>("settle-response.json");
const transactionHash = settlement.body.transaction;
if (settlement.httpStatus !== 200 || settlement.body.success !== true || !transactionHash) {
  throw new Error("The selected attempt does not contain a successful settlement");
}

const rpcResponse = await fetch(RPC_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: { hash: transactionHash },
  }),
});
if (!rpcResponse.ok) {
  throw new Error(`Stellar RPC returned HTTP ${rpcResponse.status}`);
}
const rpcBody = await rpcResponse.json() as {
  error?: unknown;
  result?: { status?: string };
};
if (rpcBody.error || rpcBody.result?.status !== "SUCCESS") {
  throw new Error(`Transaction is not confirmed: ${JSON.stringify(rpcBody)}`);
}

const attemptDirectory = await latestAttemptDirectory();
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeJson(attemptDirectory, `transaction-rpc-${timestamp}.json`, {
  queriedAt: new Date().toISOString(),
  rpcUrl: RPC_URL,
  transactionHash,
  response: rpcBody,
});

const since = new Date(Date.parse(settlement.requestedAt) - 90_000).toISOString();
const logs = execFileSync(
  "docker",
  [
    "compose",
    "--env-file", path.join(workspaceRoot, "artifacts/local/relayer/latest.env"),
    "-f", path.join(workspaceRoot, "deploy/relayer/docker-compose.yml"),
    "logs", "--no-color", `--since=${since}`, "relayer",
  ],
  { cwd: workspaceRoot, encoding: "utf8" },
);
if (!logs.includes(transactionHash)) {
  throw new Error("Relayer logs do not contain the confirmed transaction hash");
}
await writeText(attemptDirectory, `facilitator-logs-${timestamp}.txt`, logs);

console.log(JSON.stringify({
  attemptDirectory,
  transactionHash,
  rpcStatus: rpcBody.result?.status,
  archivedAt: timestamp,
}, null, 2));
