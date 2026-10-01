import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash, Keypair, xdr } from "@stellar/stellar-sdk";
import { workspaceRoot } from "./runtime.js";

if (process.env.ALLOW_OWNER_ONBOARDING !== "yes") {
  throw new Error("Owner Testnet onboarding is disabled; set ALLOW_OWNER_ONBOARDING=yes explicitly");
}

const consoleUrl = (process.env.OWNER_CONSOLE_URL ?? "http://127.0.0.1:3000").replace(/\/$/u, "");
const owner = Keypair.random();
let cookie = "";

const friendbot = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(owner.publicKey())}`);
if (!friendbot.ok) {
  throw new Error(`Stellar Friendbot could not activate the ephemeral owner: HTTP ${friendbot.status}`);
}

async function request<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${consoleUrl}${route}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json() as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(`${route} failed: ${body.message ?? body.error ?? response.status}`);
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0]!;
  return body;
}

function signPrepared(authPreimageXdr: string): string {
  const preimage = xdr.HashIdPreimage.fromXDR(authPreimageXdr, "base64");
  return owner.sign(hash(preimage.toXDR())).toString("base64");
}

const challenge = await request<{ nonce: string; message: string }>(
  `/api/owner/challenge?address=${encodeURIComponent(owner.publicKey())}`,
);
await request("/api/owner/login", {
  method: "POST",
  body: JSON.stringify({
    nonce: challenge.nonce,
    address: owner.publicKey(),
    signature: owner.signMessage(challenge.message).toString("base64"),
  }),
});

const before = await request<{ address: string; treasury: string; onboarded: boolean }>("/api/owner/profile");
if (before.onboarded) throw new Error("Ephemeral owner unexpectedly maps to an existing treasury");
const onboarded = await request<{
  address: string;
  treasury: string;
  onboarded: boolean;
  deploymentTransaction?: string;
  fundingTransaction?: string;
  fundingError?: string;
}>("/api/owner/onboard", { method: "POST" });
const overview = await request<{
  treasury: string;
  asset: string;
  assetCode: string;
  balanceAtomic: string;
  merchant: string;
  availableSigners: string[];
  allowances: Array<{ allowanceId: string }>;
}>("/api/owner/overview");
if (overview.treasury !== onboarded.treasury || overview.availableSigners.length === 0) {
  throw new Error("Owner overview does not match the deployed treasury profile");
}

const preparedCreate = await request<{ operationId: string; authPreimageXdr: string }>(
  "/api/owner/allowances/prepare",
  {
    method: "POST",
    body: JSON.stringify({
      label: "Compatibility owner",
      delegatedSigner: overview.availableSigners[0],
      maxSpendAtomic: "200000",
      windowSeconds: 3600,
      recipient: overview.merchant,
      expiresInSeconds: 3600,
    }),
  },
);
const created = await request<{
  allowanceId: string;
  treasuryContract: string;
  delegatedSigner: string;
  createTxHash?: string;
  status: string;
}>("/api/owner/allowances/submit", {
  method: "POST",
  body: JSON.stringify({
    operationId: preparedCreate.operationId,
    walletSignature: signPrepared(preparedCreate.authPreimageXdr),
  }),
});

const preparedRevoke = await request<{ operationId: string; authPreimageXdr: string }>(
  `/api/owner/allowances/${created.allowanceId}/revoke/prepare`,
  { method: "POST" },
);
const revoked = await request<{
  allowanceId: string;
  treasuryContract: string;
  revokeTxHash?: string;
  status: string;
}>("/api/owner/allowances/revoke/submit", {
  method: "POST",
  body: JSON.stringify({
    operationId: preparedRevoke.operationId,
    walletSignature: signPrepared(preparedRevoke.authPreimageXdr),
  }),
});

const evidence = {
  recordedAt: new Date().toISOString(),
  consoleUrl,
  network: "stellar:testnet",
  owner: owner.publicKey(),
  before,
  onboarded,
  overview: {
    treasury: overview.treasury,
    asset: overview.asset,
    assetCode: overview.assetCode,
    balanceAtomic: overview.balanceAtomic,
    initialAllowanceIds: overview.allowances.map((item) => item.allowanceId),
  },
  created,
  revoked,
  assertions: {
    uniqueTreasuryCreated: !before.onboarded && onboarded.onboarded,
    ownerMatchesSession: onboarded.address === owner.publicKey(),
    ownerTreasuryUsed: created.treasuryContract === onboarded.treasury && revoked.treasuryContract === onboarded.treasury,
    createSucceeded: created.status === "ACTIVE" && Boolean(created.createTxHash),
    revokeSucceeded: revoked.status === "REVOKED" && Boolean(revoked.revokeTxHash),
    ownerSecretExcluded: true,
  },
};
if (Object.values(evidence.assertions).some((value) => !value)) {
  throw new Error("Owner onboarding evidence assertions failed");
}
const directory = path.join(
  workspaceRoot,
  "docs/evidence/testnet",
  `${new Date().toISOString().replace(/[:.]/g, "-")}-multi-wallet-onboarding`,
);
await mkdir(directory, { recursive: false });
await writeFile(path.join(directory, "owner-onboarding.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ directory, ...evidence.assertions, treasury: onboarded.treasury }, null, 2));
