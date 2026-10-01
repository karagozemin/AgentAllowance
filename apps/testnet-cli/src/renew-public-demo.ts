import { Keypair, Networks, rpc } from "@stellar/stellar-sdk";
import { createContextRule, readContractValue } from "@agentallowance/sdk";
import { IDENTITIES, RPC_URL, TESTNET_USDC_SAC } from "./config.js";
import { latestRunDirectory, readRunJson, stellar, writeJson } from "./runtime.js";

type Deployment = {
  token: string;
  smartAccount: string;
  spendingPolicy: string;
  recipientPolicy: string;
  admin: string;
  merchant: string;
};

const deployment = await readRunJson<Deployment>("deployment.json");
if (deployment.token !== TESTNET_USDC_SAC) {
  throw new Error("Public demo renewal is restricted to the official Stellar Testnet USDC SAC");
}

const lifetimeLedgers = Number(process.env.DEMO_ALLOWANCE_LIFETIME_LEDGERS ?? "518400");
const windowLedgers = Number(process.env.DEMO_ALLOWANCE_WINDOW_LEDGERS ?? "720");
const spendingLimit = BigInt(process.env.DEMO_ALLOWANCE_SPENDING_LIMIT ?? "1000000");
if (!Number.isSafeInteger(lifetimeLedgers) || lifetimeLedgers <= 0) throw new Error("Invalid demo allowance lifetime");
if (!Number.isSafeInteger(windowLedgers) || windowLedgers <= 0) throw new Error("Invalid demo allowance window");
if (spendingLimit <= 0n || spendingLimit >= 1000001n) {
  throw new Error("Demo spending limit must remain below the fixed over-limit scenario amount");
}

const adminSigner = Keypair.fromSecret(stellar(["keys", "secret", IDENTITIES.admin], true));
const transactionSource = Keypair.fromSecret(stellar(["keys", "secret", IDENTITIES.feePayer], true));
if (adminSigner.publicKey() !== deployment.admin) throw new Error("Local admin signer does not match the deployment");
const delegateIdentity = process.env.DEMO_DELEGATE_IDENTITY ?? IDENTITIES.delegate2;
const delegatedSigner = stellar(["keys", "address", delegateIdentity], true);
const latestLedger = Number((await new rpc.Server(RPC_URL).getLatestLedger()).sequence);
const contextRuleCount = Number(await readContractValue({
  rpcUrl: RPC_URL,
  networkPassphrase: Networks.TESTNET,
  transactionSource: transactionSource.publicKey(),
  contractId: deployment.smartAccount,
  method: "get_context_rules_count",
  args: [],
}));
const validUntilLedger = latestLedger + lifetimeLedgers;
const result = await createContextRule({
  rpcUrl: RPC_URL,
  horizonUrl: process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  treasuryContract: deployment.smartAccount,
  assetContract: deployment.token,
  spendingPolicy: deployment.spendingPolicy,
  recipientPolicy: deployment.recipientPolicy,
  adminAddress: deployment.admin,
  adminSigner,
  transactionSource,
}, {
  label: "public-demo",
  delegatedSigner,
  maxSpendAtomic: spendingLimit,
  windowLedgers,
  recipient: deployment.merchant,
  validUntilLedger,
});
if (result.contextRuleId < contextRuleCount) throw new Error("Created context rule ID is not monotonic");

const evidence = {
  createdAt: new Date().toISOString(),
  network: "stellar:testnet",
  treasury: deployment.smartAccount,
  token: deployment.token,
  delegatedSigner,
  merchant: deployment.merchant,
  contextRuleId: result.contextRuleId,
  validUntilLedger,
  spendingLimit: spendingLimit.toString(),
  windowLedgers,
  transactionHash: result.transactionHash,
  renderEnvironment: {
    TREASURY_CONTRACT: deployment.smartAccount,
    INITIAL_DELEGATED_SIGNER: delegatedSigner,
    INITIAL_ALLOWANCE_RULE_ID: String(result.contextRuleId),
    INITIAL_ALLOWANCE_VALID_UNTIL_LEDGER: String(validUntilLedger),
    SPENDING_LIMIT: spendingLimit.toString(),
    PERIOD_LEDGERS: String(windowLedgers),
    PUBLIC_DEMO_ALLOWANCE_ID: String(result.contextRuleId),
  },
};
await writeJson(await latestRunDirectory(), "public-demo-renewal.json", evidence);
console.log(JSON.stringify(evidence, null, 2));
