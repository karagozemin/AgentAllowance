import dotenv from "dotenv";
import { Asset, Networks } from "@stellar/stellar-sdk";

dotenv.config({ path: ".env.local" });
dotenv.config();

export const NETWORK = "stellar:testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const FACILITATOR_URL = process.env.X402_FACILITATOR_URL;
export const FACILITATOR_API_KEY = process.env.X402_FACILITATOR_API_KEY;
export const TOKEN = process.env.STELLAR_TOKEN_CONTRACT ?? Asset.native().contractId(NETWORK_PASSPHRASE);

export const IDENTITIES = {
  feePayer: process.env.STELLAR_FEE_PAYER_IDENTITY ?? "agentallowance-fee-payer",
  admin: process.env.STELLAR_ADMIN_IDENTITY ?? "agentallowance-admin",
  delegate: process.env.STELLAR_DELEGATE_IDENTITY ?? "agentallowance-delegate",
  merchant: process.env.STELLAR_MERCHANT_IDENTITY ?? "agentallowance-merchant",
} as const;

export const FUND_AMOUNT = BigInt(process.env.FUND_AMOUNT ?? "5000000");
export const PAYMENT_AMOUNT = BigInt(process.env.PAYMENT_AMOUNT ?? "100000");
export const SPENDING_LIMIT = BigInt(process.env.SPENDING_LIMIT ?? "1000000");
export const PERIOD_LEDGERS = Number(process.env.PERIOD_LEDGERS ?? "17280");
export const ALLOWANCE_LIFETIME_LEDGERS = Number(
  process.env.ALLOWANCE_LIFETIME_LEDGERS ?? "17280",
);
export const MAX_TIMEOUT_SECONDS = Number(process.env.MAX_TIMEOUT_SECONDS ?? "30");
