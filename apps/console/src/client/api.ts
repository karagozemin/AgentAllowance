import type { AllowanceRecord, PaymentAttempt } from "@agentallowance/shared";

export type Overview = {
  network: string;
  treasury: string;
  asset: string;
  assetCode: string;
  assetDecimals: number;
  balanceAtomic: string;
  balanceDisplay: string;
  currentLedger: number;
  merchant: string;
  facilitatorUrl: string;
  availableSigners: string[];
  allowances: AllowanceRecord[];
  attempts: PaymentAttempt[];
  refreshedAt: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json() as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
  return body;
}

export const api = {
  overview: () => request<Overview>("/api/overview"),
  ownerChallenge: () => request<{ message: string; nonce: string; admin: string | null }>("/api/owner/challenge"),
  ownerLogin: (body: { nonce: string; address: string; signature: string }) =>
    request<{ ok: true; address: string }>("/api/owner/login", { method: "POST", body: JSON.stringify(body) }),
  createAllowance: (body: {
    label: string;
    delegatedSigner: string;
    maxSpendAtomic: string;
    windowSeconds: number;
    recipient: string;
    expiresInSeconds: number;
  }) => request<AllowanceRecord>("/api/allowances", { method: "POST", body: JSON.stringify(body) }),
  prepareWalletCreate: (body: {
    label: string; delegatedSigner: string; maxSpendAtomic: string;
    windowSeconds: number; recipient: string; expiresInSeconds: number;
  }) => request<{ operationId: string; authEntryXdr: string }>("/api/owner/allowances/prepare", {
    method: "POST", body: JSON.stringify(body),
  }),
  submitWalletCreate: (body: { operationId: string; signedAuthEntryXdr: string }) =>
    request<AllowanceRecord>("/api/owner/allowances/submit", { method: "POST", body: JSON.stringify(body) }),
  prepareWalletRevoke: (allowanceId: string) =>
    request<{ operationId: string; authEntryXdr: string }>(`/api/owner/allowances/${allowanceId}/revoke/prepare`, { method: "POST" }),
  submitWalletRevoke: (body: { operationId: string; signedAuthEntryXdr: string }) =>
    request<AllowanceRecord>("/api/owner/allowances/revoke/submit", { method: "POST", body: JSON.stringify(body) }),
  revoke: (allowance: AllowanceRecord) => request<AllowanceRecord>(
    `/api/allowances/${allowance.allowanceId}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({
        allowanceId: allowance.allowanceId,
        delegatedSigner: allowance.delegatedSigner,
      }),
    },
  ),
  run: (allowanceId: string, scenario: "success" | "over-limit" | "unapproved-recipient") =>
    request<{ ok: boolean; reason?: string; attemptId?: string; resource?: unknown }>("/api/demo/run", {
      method: "POST",
      body: JSON.stringify({ allowanceId, scenario }),
    }),
  runPublic: (scenario: "success" | "over-limit" | "unapproved-recipient") =>
    request<{ ok: boolean; reason?: string; attemptId?: string; resource?: unknown }>("/api/public-demo/run", {
      method: "POST",
      body: JSON.stringify({ scenario }),
    }),
};
