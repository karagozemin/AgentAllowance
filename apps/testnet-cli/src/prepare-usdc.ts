import { Horizon } from "@stellar/stellar-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IDENTITIES,
  TESTNET_USDC_CODE,
  TESTNET_USDC_ISSUER,
  TESTNET_USDC_SAC,
} from "./config.js";
import { identityExists, stellar, workspaceRoot } from "./runtime.js";

for (const identity of [IDENTITIES.feePayer, IDENTITIES.merchant, IDENTITIES.unapprovedRecipient]) {
  if (!identityExists(identity)) stellar(["keys", "generate", identity, "--fund", "--network", "testnet"]);
  stellar([
    "tx", "new", "change-trust",
    "--source-account", identity,
    "--line", `${TESTNET_USDC_CODE}:${TESTNET_USDC_ISSUER}`,
    "--network", "testnet",
  ], true);
}

const feePayer = stellar(["keys", "address", IDENTITIES.feePayer], true);
const account = await new Horizon.Server("https://horizon-testnet.stellar.org").loadAccount(feePayer);
const balance = account.balances.find((item) =>
  (item.asset_type === "credit_alphanum4" || item.asset_type === "credit_alphanum12") &&
  item.asset_code === TESTNET_USDC_CODE &&
  item.asset_issuer === TESTNET_USDC_ISSUER
);

const evidence = {
  assetCode: TESTNET_USDC_CODE,
  issuer: TESTNET_USDC_ISSUER,
  sac: TESTNET_USDC_SAC,
  feePayer,
  feePayerBalance: balance?.balance ?? "0.0000000",
  funded: Number(balance?.balance ?? 0) > 0,
  nextStep: Number(balance?.balance ?? 0) > 0
    ? "Set STELLAR_TOKEN_CONTRACT to sac and run deploy."
    : `Fund ${feePayer} with Stellar Testnet USDC at https://faucet.circle.com`,
};
const evidenceDirectory = path.join(
  workspaceRoot,
  "artifacts/testnet/usdc-preparation",
  new Date().toISOString().replace(/[:.]/g, "-"),
);
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(path.join(evidenceDirectory, "preparation.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, evidenceDirectory }, null, 2));
