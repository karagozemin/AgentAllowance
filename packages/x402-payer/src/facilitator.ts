import type {
  PaymentRequirements,
  SettlementReceipt,
  StellarPaymentPayload,
} from "@agentallowance/shared";

export type FacilitatorVerifyResponse = {
  isValid: boolean;
  payer?: string;
  invalidReason?: string;
};

export class FacilitatorClient {
  readonly #url: string;
  readonly #apiKey?: string;

  constructor(url: string, apiKey?: string) {
    this.#url = url.replace(/\/$/, "");
    this.#apiKey = apiKey;
  }

  async verify(
    paymentPayload: StellarPaymentPayload,
    paymentRequirements: PaymentRequirements,
    signal?: AbortSignal,
  ): Promise<FacilitatorVerifyResponse> {
    return this.#post<FacilitatorVerifyResponse>("verify", { paymentPayload, paymentRequirements }, signal);
  }

  async settle(
    paymentPayload: StellarPaymentPayload,
    paymentRequirements: PaymentRequirements,
    signal?: AbortSignal,
  ): Promise<SettlementReceipt> {
    const response = await this.#post<{
      success?: boolean;
      errorReason?: string;
      transaction?: string;
      network?: string;
      payer?: string;
    }>("settle", { paymentPayload, paymentRequirements }, signal);
    if (!response.success || !response.transaction || !response.payer) {
      throw new Error(response.errorReason ?? "Facilitator settlement failed");
    }
    return {
      success: true,
      transaction: response.transaction,
      network: paymentRequirements.network,
      payer: response.payer,
      amount: paymentRequirements.amount,
      asset: paymentRequirements.asset,
      payTo: paymentRequirements.payTo,
      challengeId: String(paymentRequirements.extra.challengeId ?? ""),
    };
  }

  async #post<T>(route: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;
    const response = await fetch(`${this.#url}/${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const value = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(value.error ?? `Facilitator HTTP ${response.status}`);
    return value;
  }
}
