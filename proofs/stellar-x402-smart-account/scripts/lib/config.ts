import dotenv from "dotenv";
import { Asset, Networks } from "@stellar/stellar-sdk";

dotenv.config({ path: ".env.local" });
dotenv.config();

export const NETWORK = "stellar:testnet";
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
export const FACILITATOR_URL =
  process.env.OZ_X402_BASE_URL ?? "https://channels.openzeppelin.com/x402/testnet";
export const API_KEY = process.env.OZ_X402_API_KEY;
export const TOKEN = Asset.native().contractId(NETWORK_PASSPHRASE);

export const IDENTITIES = {
  feePayer: "x402-proof-fee-payer",
  delegate: "x402-proof-delegate",
  merchant: "x402-proof-merchant",
} as const;

export const FUND_AMOUNT = 5_000_000n;
export const PAYMENT_AMOUNT = 100_000n;
export const SPENDING_LIMIT = 1_000_000n;
export const PERIOD_LEDGERS = 17_280;
export const MAX_TIMEOUT_SECONDS = 30;
