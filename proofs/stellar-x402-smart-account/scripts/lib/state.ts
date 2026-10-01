import { stellar } from "./cli.js";
import { IDENTITIES } from "./config.js";

function decode(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function readState(deployment: any): Record<string, unknown> {
  const common = ["--source-account", IDENTITIES.feePayer, "--network", "testnet", "--send", "no"];
  const smartBalance = stellar([
    "contract",
    "invoke",
    "--id",
    deployment.token,
    ...common,
    "--",
    "balance",
    "--id",
    deployment.smartAccount,
  ]);
  const merchantBalance = stellar([
    "contract",
    "invoke",
    "--id",
    deployment.token,
    ...common,
    "--",
    "balance",
    "--id",
    deployment.merchant,
  ]);
  const spendingLimit = stellar([
    "contract",
    "invoke",
    "--id",
    deployment.policy,
    ...common,
    "--",
    "get_spending_limit_data",
    "--context-rule-id",
    String(deployment.ruleId),
    "--smart-account",
    deployment.smartAccount,
  ]);
  return {
    capturedAt: new Date().toISOString(),
    smartAccountBalance: decode(smartBalance),
    merchantBalance: decode(merchantBalance),
    spendingLimit: decode(spendingLimit),
  };
}

