import crypto from "crypto";
export class NeutronClient {
    config;
    accountId = null;
    accessToken = null;
    tokenExpiry = 0;
    cachedAuthResponse = null;
    constructor(config) {
        this.config = config;
    }
    generateSignature(payload) {
        const stringToSign = `${this.config.apiKey}&payload=${payload}`;
        return crypto
            .createHmac("sha256", this.config.apiSecret)
            .update(stringToSign)
            .digest("hex");
    }
    async ensureAuthenticated() {
        if (this.cachedAuthResponse &&
            this.accessToken &&
            this.accountId &&
            Date.now() < this.tokenExpiry) {
            return this.cachedAuthResponse;
        }
        const payload = JSON.stringify({ test: "auth" });
        const signature = this.generateSignature(payload);
        const response = await fetch(`${this.config.apiUrl}/api/v2/authentication/token-signature`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Api-Key": this.config.apiKey,
                "X-Api-Signature": signature,
            },
            body: payload,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(`Authentication failed: ${response.status} - ${error.message || error.error || response.statusText}`);
        }
        const authResult = (await response.json());
        this.accountId = authResult.accountId;
        this.accessToken = authResult.accessToken;
        this.cachedAuthResponse = authResult;
        this.tokenExpiry = authResult.expiredAt
            ? new Date(authResult.expiredAt).getTime()
            : Date.now() + 3600000;
        return authResult;
    }
    async authenticate() {
        this.accessToken = null;
        this.accountId = null;
        this.tokenExpiry = 0;
        this.cachedAuthResponse = null;
        return this.ensureAuthenticated();
    }
    getAccountId() {
        return this.accountId;
    }
    async request(method, path, body) {
        await this.ensureAuthenticated();
        const url = `${this.config.apiUrl}${path}`;
        const headers = {
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
            throw new Error(`API Error ${response.status}: ${error.error || error.message || response.statusText}`);
        }
        return await response.json();
    }
    // ── Account ──────────────────────────────────────────────
    async getAccount() {
        await this.ensureAuthenticated();
        return this.request("GET", `/api/v2/account/${this.accountId}`);
    }
    async getWallets() {
        await this.ensureAuthenticated();
        return this.request("GET", `/api/v2/account/${this.accountId}/wallet/`);
    }
    async getWallet(walletId) {
        await this.ensureAuthenticated();
        return this.request("GET", `/api/v2/account/${this.accountId}/wallet/${walletId}`);
    }
    // ── Transactions ─────────────────────────────────────────
    async createTransaction(body) {
        return this.request("POST", `/api/v2/transaction`, body);
    }
    async confirmTransaction(transactionId) {
        return this.request("PUT", `/api/v2/transaction/${transactionId}/confirm`);
    }
    async getTransaction(transactionId) {
        return this.request("GET", `/api/v2/transaction/${transactionId}`);
    }
    async listTransactions(params) {
        const qs = new URLSearchParams();
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== null)
                    qs.append(k, String(v));
            }
        }
        const query = qs.toString();
        return this.request("GET", `/api/v2/transaction${query ? `?${query}` : ""}`);
    }
    // ── Lightning ────────────────────────────────────────────
    async decodeInvoice(invoice) {
        return this.request("GET", `/api/v2/lightning/invoice?invoice=${encodeURIComponent(invoice)}`);
    }
    async resolveLightningAddress(address, amountMsat) {
        let path = `/api/v2/lightning/resolve-ln-address?lnAddress=${encodeURIComponent(address)}`;
        if (amountMsat !== undefined)
            path += `&amount=${amountMsat}`;
        return this.request("GET", path);
    }
    async resolveLnurl(lnurl) {
        return this.request("GET", `/api/v2/lightning/resolve-lnurl?lnurl=${encodeURIComponent(lnurl)}`);
    }
    // ── Receive Addresses ────────────────────────────────────
    async getBtcReceiveAddress() {
        return this.request("GET", `/api/v2/account/onchain-address`);
    }
    async getUsdtReceiveAddress(chainId = "TRON") {
        return this.request("GET", `/api/v2/account/stablecoin-onchain-address?walletCcy=USDT&chainId=${chainId}`);
    }
    // ── Webhooks ─────────────────────────────────────────────
    async createWebhook(body) {
        return this.request("POST", `/api/v2/webhook`, body);
    }
    async listWebhooks() {
        return this.request("GET", `/api/v2/webhook`);
    }
    async updateWebhook(webhookId, body) {
        return this.request("PUT", `/api/v2/webhook/${webhookId}`, body);
    }
    async deleteWebhook(webhookId) {
        await this.request("DELETE", `/api/v2/webhook/${webhookId}`);
    }
    // ── Reference Data ───────────────────────────────────────
    async getRate() {
        return this.request("GET", `/api/v2/rate`);
    }
    async getFiatInstitutions(countryCode) {
        return this.request("GET", `/api/v2/reference/fiat-institution/by-country/${countryCode}`);
    }
}
//# sourceMappingURL=neutron-client.js.map