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
export declare class NeutronClient {
    private config;
    private accountId;
    private accessToken;
    private tokenExpiry;
    private cachedAuthResponse;
    constructor(config: NeutronConfig);
    private generateSignature;
    private ensureAuthenticated;
    authenticate(): Promise<AuthResponse>;
    getAccountId(): string | null;
    private request;
    getAccount(): Promise<any>;
    getWallets(): Promise<any>;
    getWallet(walletId: string): Promise<any>;
    createTransaction(body: any): Promise<any>;
    confirmTransaction(transactionId: string): Promise<any>;
    getTransaction(transactionId: string): Promise<any>;
    listTransactions(params?: Record<string, any>): Promise<any>;
    getBtcReceiveAddress(): Promise<any>;
    getUsdtReceiveAddress(chainId?: string): Promise<any>;
    createWebhook(body: {
        callback: string;
        secret: string;
    }): Promise<any>;
    listWebhooks(): Promise<any>;
    updateWebhook(webhookId: string, body: any): Promise<any>;
    deleteWebhook(webhookId: string): Promise<void>;
    getRate(): Promise<any>;
    getFiatInstitutions(countryCode: string): Promise<any>;
}
export {};
//# sourceMappingURL=neutron-client.d.ts.map