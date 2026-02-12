import crypto from "crypto";

interface NeutronConfig {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

interface AuthResponse {
  accountId: string;
  accessToken: string;
  expiredAt?: string;
  [key: string]: any;
}

export class NeutronClient {
  private config: NeutronConfig;
  private accountId: string | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private cachedAuthResponse: AuthResponse | null = null;

  constructor(config: NeutronConfig) {
    this.config = config;
  }

  private generateSignature(payload: string): string {
    const stringToSign = `${this.config.apiKey}&payload=${payload}`;
    return crypto
      .createHmac("sha256", this.config.apiSecret)
      .update(stringToSign)
      .digest("hex");
  }

  private async ensureAuthenticated(): Promise<AuthResponse> {
    if (
      this.cachedAuthResponse &&
      this.accessToken &&
      this.accountId &&
      Date.now() < this.tokenExpiry
    ) {
      return this.cachedAuthResponse;
    }

    const payload = JSON.stringify({ test: "auth" });
    const signature = this.generateSignature(payload);

    const response = await fetch(
      `${this.config.apiUrl}/api/v2/authentication/token-signature`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": this.config.apiKey,
          "X-Api-Signature": signature,
        },
        body: payload,
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Authentication failed: ${response.status} - ${(error as any).message || (error as any).error || response.statusText}`
      );
    }

    const authResult = (await response.json()) as AuthResponse;
    this.accountId = authResult.accountId;
    this.accessToken = authResult.accessToken;
    this.cachedAuthResponse = authResult;
    this.tokenExpiry = authResult.expiredAt
      ? new Date(authResult.expiredAt).getTime()
      : Date.now() + 3600000;

    return authResult;
  }

  async authenticate(): Promise<AuthResponse> {
    this.accessToken = null;
    this.accountId = null;
    this.tokenExpiry = 0;
    this.cachedAuthResponse = null;
    return this.ensureAuthenticated();
  }

  getAccountId(): string | null {
    return this.accountId;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    await this.ensureAuthenticated();

    const url = `${this.config.apiUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
    };
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `API Error ${response.status}: ${(error as any).error || (error as any).message || response.statusText}`
      );
    }

    return await response.json();
  }

  // ── Account ──────────────────────────────────────────────

  async getAccount(): Promise<any> {
    await this.ensureAuthenticated();
    return this.request("GET", `/api/v2/account/${this.accountId}`);
  }

  async getWallets(): Promise<any> {
    await this.ensureAuthenticated();
    return this.request("GET", `/api/v2/account/${this.accountId}/wallet/`);
  }

  async getWallet(walletId: string): Promise<any> {
    await this.ensureAuthenticated();
    return this.request("GET", `/api/v2/account/${this.accountId}/wallet/${walletId}`);
  }

  // ── Transactions ─────────────────────────────────────────

  async createTransaction(body: any): Promise<any> {
    return this.request("POST", `/api/v2/transaction`, body);
  }

  async confirmTransaction(transactionId: string): Promise<any> {
    return this.request("PUT", `/api/v2/transaction/${transactionId}/confirm`);
  }

  async getTransaction(transactionId: string): Promise<any> {
    return this.request("GET", `/api/v2/transaction/${transactionId}`);
  }

  async listTransactions(params?: Record<string, any>): Promise<any> {
    const qs = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) qs.append(k, String(v));
      }
    }
    const query = qs.toString();
    return this.request("GET", `/api/v2/transaction${query ? `?${query}` : ""}`);
  }

  // ── Receive Addresses ────────────────────────────────────

  async getBtcReceiveAddress(): Promise<any> {
    return this.request("GET", `/api/v2/account/onchain-address`);
  }

  async getUsdtReceiveAddress(chainId: string = "TRON"): Promise<any> {
    return this.request("GET", `/api/v2/account/stablecoin-onchain-address?walletCcy=USDT&chainId=${chainId}`);
  }

  // ── Webhooks ─────────────────────────────────────────────

  async createWebhook(body: { callback: string; secret: string }): Promise<any> {
    return this.request("POST", `/api/v2/webhook`, body);
  }

  async listWebhooks(): Promise<any> {
    return this.request("GET", `/api/v2/webhook`);
  }

  async updateWebhook(webhookId: string, body: any): Promise<any> {
    return this.request("PUT", `/api/v2/webhook/${webhookId}`, body);
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request("DELETE", `/api/v2/webhook/${webhookId}`);
  }

  // ── Reference Data ───────────────────────────────────────

  async getRate(): Promise<any> {
    return this.request("GET", `/api/v2/rate`);
  }

  async getFiatInstitutions(countryCode: string): Promise<any> {
    return this.request("GET", `/api/v2/reference/fiat-institution/by-country/${countryCode}`);
  }
}
