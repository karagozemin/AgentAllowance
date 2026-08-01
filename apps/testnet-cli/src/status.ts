import { IDENTITIES } from "./config.js";
import { latestRunDirectory, readRunJson, stellar, writeJson } from "./runtime.js";

type Deployment = {
  token: string;
  smartAccount: string;
  merchant: string;
  spendingPolicy: string;
  allowanceRuleId: number;
};
const deployment = await readRunJson<Deployment>("deployment.json");
const invoke = (contract: string, fn: string, args: string[]) => stellar([
  "contract", "invoke", "--id", contract,
  "--source-account", IDENTITIES.feePayer,
  "--network", "testnet", "--send", "no", "--", fn, ...args,
]);
const parse = (value: string): unknown => {
  try { return JSON.parse(value); } catch { return value; }
};
const state = {
  capturedAt: new Date().toISOString(),
  smartAccountBalance: parse(invoke(deployment.token, "balance", ["--id", deployment.smartAccount])),
  merchantBalance: parse(invoke(deployment.token, "balance", ["--id", deployment.merchant])),
  spendingLimit: parse(invoke(deployment.spendingPolicy, "get_spending_limit_data", [
    "--context-rule-id", String(deployment.allowanceRuleId),
    "--smart-account", deployment.smartAccount,
  ])),
};
const label = process.env.STATE_LABEL ?? "current";
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("STATE_LABEL contains unsupported characters");
await writeJson(await latestRunDirectory(), `state-${label}.json`, state);
console.log(JSON.stringify(state, null, 2));
