import dotenv from "dotenv";
import { Keypair } from "@stellar/stellar-sdk";
import { AgentAllowance, SqliteEvidenceStore } from "@agentallowance/sdk";

dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function keypair(name: string): Keypair {
  return Keypair.fromSecret(required(name));
}

const delegated = keypair("DELEGATED_SIGNER_SECRET");
const transactionSource = keypair("FEE_PAYER_SECRET");
const sdk = new AgentAllowance({
  network: "stellar:testnet",
  rpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
  assetContract: required("STELLAR_TOKEN_CONTRACT"),
  treasuryContract: required("TREASURY_CONTRACT"),
  spendingPolicy: required("SPENDING_POLICY_CONTRACT"),
  recipientPolicy: required("RECIPIENT_POLICY_CONTRACT"),
  facilitatorUrl: required("X402_FACILITATOR_URL"),
  facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
  transactionSource,
  adminAddress: required("ADMIN_ADDRESS"),
  delegatedSigners: { [delegated.publicKey()]: delegated },
  store: new SqliteEvidenceStore(process.env.DATABASE_URL ?? ":memory:"),
});

const response = await sdk.fetch(required("PAID_URL"), {
  allowanceId: required("ALLOWANCE_ID"),
});
console.log(JSON.stringify({
  status: response.status,
  contentType: response.headers.get("content-type"),
  body: await response.text(),
}, null, 2));
