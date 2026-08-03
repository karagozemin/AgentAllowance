import dotenv from "dotenv";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { fileURLToPath } from "node:url";
import path from "node:path";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
dotenv.config({ path: path.join(workspaceRoot, ".env.local") });
dotenv.config({ path: path.join(workspaceRoot, ".env") });
dotenv.config({ path: path.join(workspaceRoot, "artifacts/local/relayer/latest.env") });

export const NETWORK = "stellar:testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const TESTNET_USDC_CODE = "USDC";
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const TESTNET_USDC_SAC = new Asset(TESTNET_USDC_CODE, TESTNET_USDC_ISSUER).contractId(NETWORK_PASSPHRASE);
export const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const FACILITATOR_URL = process.env.X402_FACILITATOR_URL;
export const FACILITATOR_API_KEY = process.env.X402_FACILITATOR_API_KEY;
export const TOKEN = process.env.STELLAR_TOKEN_CONTRACT ?? Asset.native().contractId(NETWORK_PASSPHRASE);

export const IDENTITIES = {
  feePayer: process.env.STELLAR_FEE_PAYER_IDENTITY ?? "agentallowance-fee-payer",
  relayer: process.env.STELLAR_RELAYER_IDENTITY ?? "agentallowance-relayer",
  admin: process.env.STELLAR_ADMIN_IDENTITY ?? "agentallowance-admin",
  delegate: process.env.STELLAR_DELEGATE_IDENTITY ?? "agentallowance-delegate",
  delegate2: process.env.STELLAR_DELEGATE_2_IDENTITY ?? "agentallowance-delegate-2",
  merchant: process.env.STELLAR_MERCHANT_IDENTITY ?? "agentallowance-merchant",
  unapprovedRecipient:
    process.env.STELLAR_UNAPPROVED_RECIPIENT_IDENTITY ?? "agentallowance-unapproved-recipient",
} as const;

export const SCENARIOS = ["successful-payment", "over-limit", "unapproved-recipient"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function selectedScenario(): Scenario {
  const value = process.env.SCENARIO ?? "successful-payment";
  if (!SCENARIOS.includes(value as Scenario)) {
    throw new Error(`SCENARIO must be one of: ${SCENARIOS.join(", ")}`);
  }
  return value as Scenario;
}

export const FUND_AMOUNT = BigInt(process.env.FUND_AMOUNT ?? "5000000");
export const PAYMENT_AMOUNT = BigInt(process.env.PAYMENT_AMOUNT ?? "100000");
export const SPENDING_LIMIT = BigInt(process.env.SPENDING_LIMIT ?? "1000000");
export const PERIOD_LEDGERS = Number(process.env.PERIOD_LEDGERS ?? "17280");
export const ALLOWANCE_LIFETIME_LEDGERS = Number(
  process.env.ALLOWANCE_LIFETIME_LEDGERS ?? "17280",
);
export const MAX_TIMEOUT_SECONDS = Number(process.env.MAX_TIMEOUT_SECONDS ?? "60");
