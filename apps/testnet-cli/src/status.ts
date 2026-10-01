import { IDENTITIES } from "./config.js";
import { latestRunDirectory, readRunJson, stellar, writeJson } from "./runtime.js";

type Deployment = {
  token: string;
  smartAccount: string;
  merchant: string;
  spendingPolicy: string;
  recipientPolicy: string;
  allowanceRuleId: number;
};
const deployment = await readRunJson<Deployment>("deployment.json");
const allowanceRuleId = process.env.ALLOWANCE_RULE_ID_OVERRIDE
  ? Number(process.env.ALLOWANCE_RULE_ID_OVERRIDE)
  : deployment.allowanceRuleId;
if (!Number.isSafeInteger(allowanceRuleId) || allowanceRuleId < 0) {
  throw new Error("ALLOWANCE_RULE_ID_OVERRIDE must be a non-negative safe integer");
}
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
  allowanceRuleId,
  smartAccountBalance: parse(invoke(deployment.token, "balance", ["--id", deployment.smartAccount])),
  merchantBalance: parse(invoke(deployment.token, "balance", ["--id", deployment.merchant])),
  spendingLimit: parse(invoke(deployment.spendingPolicy, "get_spending_limit_data", [
    "--context-rule-id", String(allowanceRuleId),
    "--smart-account", deployment.smartAccount,
  ])),
  recipientPolicy: parse(invoke(deployment.recipientPolicy, "get_config", [
    "--context-rule-id", String(allowanceRuleId),
    "--smart-account", deployment.smartAccount,
  ])),
};
const label = process.env.STATE_LABEL ?? "current";
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("STATE_LABEL contains unsupported characters");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
await writeJson(await latestRunDirectory(), `state-${label}-${timestamp}.json`, state);
console.log(JSON.stringify(state, null, 2));
