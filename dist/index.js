#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { NeutronClient } from "./neutron-client.js";
// ── Singleton client (reuses auth token across tool calls) ─
let _client = null;
function getClient() {
    if (_client)
        return _client;
    const apiUrl = process.env.NEUTRON_API_URL || "https://api.neutron.me";
    const apiKey = process.env.NEUTRON_API_KEY;
    const apiSecret = process.env.NEUTRON_API_SECRET;
    if (!apiKey || !apiSecret) {
        throw new Error("NEUTRON_API_KEY and NEUTRON_API_SECRET environment variables are required. " +
            "Get your credentials at https://neutron.me");
    }
    _client = new NeutronClient({ apiUrl, apiKey, apiSecret });
    return _client;
}
// ── MCP server ─────────────────────────────────────────────
const server = new Server({ name: "neutron-mcp-server", version: "1.3.0" }, { capabilities: { tools: {} } });
// ── Lending PoC client ────────────────────────────────────
const LENDING_API = process.env.NEUTRON_LENDING_URL || "http://localhost:3001";
async function lendingRequest(method, path, body) {
    const url = `${LENDING_API}${path}`;
    const opts = {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    };
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok)
        throw new Error(data.error || `Lending API error ${res.status}`);
    return data;
}
// ── Tool definitions ───────────────────────────────────────
const tools = [
    // ── Authentication ──
    {
        name: "neutron_authenticate",
        description: "Verify your Neutron API credentials. Returns your account ID and confirms access is working.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    // ── Account ──
    {
        name: "neutron_get_account",
        description: "Get account details: display name, status, country, timezone, and sub-accounts.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "neutron_get_wallets",
        description: "List all wallets with balances. Shows each currency (BTC, USDT, fiat) with total and available balance.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "neutron_get_wallet",
        description: "Get a specific wallet by ID. Shows balance, available balance, and currency.",
        inputSchema: {
            type: "object",
            properties: {
                walletId: { type: "string", description: "Wallet ID (e.g. wal_btc_001)" },
            },
            required: ["walletId"],
        },
    },
    // ── Create Lightning Invoice (receive) ──
    {
        name: "neutron_create_lightning_invoice",
        description: `Create a Lightning invoice to receive Bitcoin. Returns a BOLT11 payment request and QR code page.

Examples:
- Receive 10,000 sats: amountSats=10000
- Receive 0.001 BTC: amountBtc=0.001
- With tracking: amountSats=5000, extRefId="order-123"`,
        inputSchema: {
            type: "object",
            properties: {
                amountSats: {
                    type: "number",
                    description: "Amount in satoshis (e.g. 10000 = 10,000 sats). Use this OR amountBtc.",
                },
                amountBtc: {
                    type: "number",
                    description: "Amount in BTC (e.g. 0.0001). Use this OR amountSats.",
                },
                memo: { type: "string", description: "Invoice description shown to the payer" },
                extRefId: { type: "string", description: "Your reference ID for tracking (e.g. order ID)" },
            },
            required: [],
        },
    },
    // ── Create Transaction (universal) ──
    {
        name: "neutron_create_transaction",
        description: `Create a transaction. Supports all payment types:

Lightning send: sourceCcy="BTC", sourceMethod="neutronpay", destCcy="BTC", destMethod="lightning", paymentRequest="lnbc..."
Lightning Address: sourceCcy="BTC", sourceMethod="neutronpay", destCcy="BTC", destMethod="lnurl", lnurl="user@wallet.com", sourceAmount=0.0001
On-chain send: sourceCcy="BTC", sourceMethod="neutronpay", destCcy="BTC", destMethod="on-chain", address="bc1q..."
On-chain receive: sourceCcy="BTC", sourceMethod="on-chain", destCcy="BTC", destMethod="neutronpay", destAmount=0.001
USDT send (TRON): sourceCcy="USDT", sourceMethod="neutronpay", destCcy="USDT", destMethod="tron", address="T..."
Internal swap: sourceCcy="BTC", sourceMethod="neutronpay", destCcy="USDT", destMethod="neutronpay", sourceAmount=0.001
Fiat payout: sourceCcy="BTC", sourceMethod="neutronpay", destCcy="VND", destMethod="vnd-instant", bankAcctNum="...", institutionCode="...", recipientName="...", countryCode="VN"

Amounts are in BTC (not sats). 100 sats = 0.00000100 BTC.
Set amount on ONE side only (source OR dest), not both.
Returns a quoted transaction — call neutron_confirm_transaction to execute.`,
        inputSchema: {
            type: "object",
            properties: {
                // Source
                sourceCcy: {
                    type: "string",
                    description: "Source currency: BTC, USDT, VND, USD, CAD, etc.",
                },
                sourceMethod: {
                    type: "string",
                    description: "Source method: neutronpay (from wallet), lightning (receive LN), on-chain (receive BTC)",
                },
                sourceAmount: {
                    type: "number",
                    description: "Amount from source (in BTC for Bitcoin). Set on source OR dest, not both.",
                },
                // Destination
                destCcy: {
                    type: "string",
                    description: "Destination currency: BTC, USDT, VND, USD, CAD, etc.",
                },
                destMethod: {
                    type: "string",
                    description: "Dest method: neutronpay (to wallet), lightning (pay invoice), lnurl (pay LN address), on-chain, tron, eth, vnd-instant, etc.",
                },
                destAmount: {
                    type: "number",
                    description: "Amount to destination. Set on source OR dest, not both.",
                },
                // Destination details
                paymentRequest: {
                    type: "string",
                    description: "BOLT11 Lightning invoice to pay (for destMethod=lightning)",
                },
                lnurl: {
                    type: "string",
                    description: "Lightning Address (user@domain.com) or LNURL string (for destMethod=lnurl)",
                },
                address: {
                    type: "string",
                    description: "Crypto address: Bitcoin (bc1q...), TRON (T...), Ethereum (0x...)",
                },
                // Fiat payout fields
                bankAcctNum: {
                    type: "string",
                    description: "Bank account number (for fiat payouts)",
                },
                institutionCode: {
                    type: "string",
                    description: "Bank code from neutron_get_fiat_institutions (for fiat payouts)",
                },
                recipientName: {
                    type: "string",
                    description: "Recipient legal full name (required for fiat payouts)",
                },
                countryCode: {
                    type: "string",
                    description: "Recipient country code e.g. VN, NG, KE (required for fiat payouts)",
                },
                kycType: {
                    type: "string",
                    enum: ["individual", "business"],
                    description: "Recipient type (for fiat payouts, default: individual)",
                },
                // Tracking
                extRefId: {
                    type: "string",
                    description: "Your reference ID for tracking",
                },
            },
            required: ["sourceCcy", "sourceMethod", "destCcy", "destMethod"],
        },
    },
    // ── Transaction management ──
    {
        name: "neutron_confirm_transaction",
        description: "Confirm a quoted transaction to execute it. Call this after neutron_create_transaction.",
        inputSchema: {
            type: "object",
            properties: {
                transactionId: { type: "string", description: "Transaction ID (txnId) to confirm" },
            },
            required: ["transactionId"],
        },
    },
    {
        name: "neutron_get_transaction",
        description: "Check transaction status and details. Use to track payment progress after confirmation.",
        inputSchema: {
            type: "object",
            properties: {
                transactionId: { type: "string", description: "Transaction ID (txnId)" },
            },
            required: ["transactionId"],
        },
    },
    {
        name: "neutron_list_transactions",
        description: "List transactions with optional filters. Returns recent transactions by default.",
        inputSchema: {
            type: "object",
            properties: {
                status: { type: "string", description: "Filter by state: quoted, completed, failed, expired, etc." },
                method: { type: "string", description: "Filter by method: lightning, on-chain, tron, etc." },
                currency: { type: "string", description: "Filter by currency: BTC, USDT, VND, etc." },
                fromDate: { type: "string", description: "Start date (ISO 8601)" },
                toDate: { type: "string", description: "End date (ISO 8601)" },
                limit: { type: "number", description: "Max results (default 20)" },
                offset: { type: "number", description: "Offset for pagination" },
            },
            required: [],
        },
    },
    // ── Receive addresses ──
    {
        name: "neutron_get_btc_address",
        description: "Get your Bitcoin on-chain deposit address. Static, reusable SegWit (bc1q...) address.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "neutron_get_usdt_address",
        description: "Get your USDT deposit address on TRON (TRC-20) or Ethereum (ERC-20).",
        inputSchema: {
            type: "object",
            properties: {
                chain: {
                    type: "string",
                    enum: ["TRON", "ETH"],
                    description: "Blockchain: TRON (recommended, faster & cheaper) or ETH. Default: TRON",
                },
            },
            required: [],
        },
    },
    // ── Webhooks ──
    {
        name: "neutron_create_webhook",
        description: "Register a webhook to receive transaction state change notifications. Requires an HTTPS callback URL.",
        inputSchema: {
            type: "object",
            properties: {
                callback: { type: "string", description: "Your HTTPS webhook endpoint URL" },
                secret: { type: "string", description: "Secret for verifying webhook signatures (X-Neutronpay-Signature header)" },
            },
            required: ["callback", "secret"],
        },
    },
    {
        name: "neutron_list_webhooks",
        description: "List all registered webhooks.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "neutron_update_webhook",
        description: "Update a webhook's callback URL or secret.",
        inputSchema: {
            type: "object",
            properties: {
                webhookId: { type: "string", description: "Webhook ID to update" },
                callback: { type: "string", description: "New callback URL" },
                secret: { type: "string", description: "New webhook secret" },
            },
            required: ["webhookId"],
        },
    },
    {
        name: "neutron_delete_webhook",
        description: "Delete a webhook.",
        inputSchema: {
            type: "object",
            properties: {
                webhookId: { type: "string", description: "Webhook ID to delete" },
            },
            required: ["webhookId"],
        },
    },
    // ── Reference data ──
    // ── Lending ──
    {
        name: "neutron_lend_simulate",
        description: "Preview a collateralized loan. Deposit BTC as collateral, receive USDT. Shows loan amount, interest (8% APR), total payback, and liquidation price.",
        inputSchema: {
            type: "object",
            properties: {
                btcAmount: { type: "number", description: "BTC amount to use as collateral (e.g. 1.0)" },
                ltvRatio: { type: "number", enum: [0.5, 0.6], description: "Loan-to-value ratio: 0.5 (50%, safer) or 0.6 (60%, more USDT but higher liquidation risk)" },
            },
            required: ["btcAmount", "ltvRatio"],
        },
    },
    {
        name: "neutron_lend_quote",
        description: "Lock a BTC price for 6 minutes. Use this before creating a loan to guarantee the price. Returns a quoteId to pass to neutron_lend_create.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "Your agent identifier" },
                btcAmount: { type: "number", description: "BTC collateral amount" },
                ltvRatio: { type: "number", enum: [0.5, 0.6], description: "LTV ratio: 0.5 or 0.6" },
            },
            required: ["agentId", "btcAmount", "ltvRatio"],
        },
    },
    {
        name: "neutron_lend_create",
        description: "Create a collateralized loan with real 2-of-3 multisig. Flow: quote (optional) → create → send BTC to depositAddress → confirm collateral → USDt disbursed. If borrowerPubkey provided, a real P2WSH multisig deposit address is generated. Returns depositAddress, dlcContractId, and multisig keys.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "Your agent identifier" },
                btcAmount: { type: "number", description: "BTC collateral amount" },
                ltvRatio: { type: "number", enum: [0.5, 0.6], description: "LTV ratio: 0.5 or 0.6" },
                returnAddress: { type: "string", description: "BTC address to return collateral after full repayment (bc1q... or tb1q... for testnet)" },
                usdtReceiveAddress: { type: "string", description: "Your Ethereum/Base address to receive USDt loan (0x...)" },
                quoteId: { type: "string", description: "Optional — quoteId from neutron_lend_quote to lock price" },
                borrowerPubkey: { type: "string", description: "Optional — your compressed BTC public key (hex, 66 chars) for real 2-of-3 multisig. If omitted, a simulated deposit address is used." },
            },
            required: ["agentId", "btcAmount", "ltvRatio", "returnAddress", "usdtReceiveAddress"],
        },
    },
    {
        name: "neutron_lend_confirm_collateral",
        description: "Confirm BTC collateral deposit. Call after sending BTC to the multisig address. Requires 3+ on-chain confirmations. After confirmation, USDt can be disbursed.",
        inputSchema: {
            type: "object",
            properties: {
                loanId: { type: "string", description: "Loan ID" },
                btcDepositTxid: { type: "string", description: "BTC deposit transaction ID" },
                confirmations: { type: "number", description: "Number of on-chain confirmations (minimum 3)" },
            },
            required: ["loanId", "btcDepositTxid", "confirmations"],
        },
    },
    {
        name: "neutron_lend_disburse",
        description: "Disburse USDt loan to agent's Ethereum address. Only works after BTC collateral is confirmed. Returns the Etherscan transaction link.",
        inputSchema: {
            type: "object",
            properties: {
                loanId: { type: "string", description: "Loan ID" },
            },
            required: ["loanId"],
        },
    },
    {
        name: "neutron_lend_status",
        description: "Get loan details: collateral, loan amount, total owed, repaid amount, liquidation price, status, repayment history.",
        inputSchema: {
            type: "object",
            properties: {
                loanId: { type: "string", description: "Loan ID" },
            },
            required: ["loanId"],
        },
    },
    {
        name: "neutron_lend_repay",
        description: "Make a USDt (ERC-20) repayment on a loan. Send USDt to the loan's repayment address, then call this with the Ethereum transaction ID. Can be partial or full. When fully repaid, BTC collateral is automatically released.",
        inputSchema: {
            type: "object",
            properties: {
                loanId: { type: "string", description: "Loan ID" },
                usdtAmount: { type: "number", description: "USDt amount repaid" },
                ethTxid: { type: "string", description: "Ethereum transaction hash of the USDt payment (0x...)" },
                fromAddress: { type: "string", description: "Ethereum address the USDt was sent from (0x...)" },
            },
            required: ["loanId", "usdtAmount"],
        },
    },
    {
        name: "neutron_lend_list",
        description: "List all loans for an agent. Shows active, repaid, liquidated, and defaulted loans.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "Agent ID to list loans for" },
            },
            required: ["agentId"],
        },
    },
    {
        name: "neutron_lend_rollover",
        description: "Rollover/extend a loan by 1 year. Adds $500 flat fee and increases interest rate by 1% (e.g. 8%→9%). IMPORTANT: Before calling this, you MUST present the terms to the user and get explicit acceptance: $500 fee, +1% interest, new expiry, non-refundable. Set acceptTerms=true only after user confirms.",
        inputSchema: {
            type: "object",
            properties: {
                loanId: { type: "string", description: "Loan ID to rollover" },
                acceptTerms: { type: "boolean", description: "Must be true — confirms user accepted rollover terms ($500 fee, +1% interest, 1yr extension)" },
            },
            required: ["loanId", "acceptTerms"],
        },
    },
    {
        name: "neutron_lend_check_liquidation",
        description: "Check if a loan should be liquidated based on current BTC price. If price is below liquidation threshold, collateral is seized.",
        inputSchema: {
            type: "object",
            properties: {
                loanId: { type: "string", description: "Loan ID" },
            },
            required: ["loanId"],
        },
    },
    {
        name: "neutron_lend_btc_price",
        description: "Get the current BTC price used by the lending engine.",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "neutron_lend_settle",
        description: "Settle a fully-repaid loan by releasing BTC collateral from the 2-of-3 multisig back to the borrower's return address. Only works when loan status is 'repaid'. Broadcasts a signed Bitcoin transaction and returns the settlement txid with explorer link.",
        inputSchema: {
            type: "object",
            properties: {
                loanId: { type: "string", description: "Loan ID to settle" },
            },
            required: ["loanId"],
        },
    },
    {
        name: "neutron_lend_notifications",
        description: "Get notifications for an agent. Includes expiry warnings, payment confirmations, liquidation alerts, and rollover confirmations.",
        inputSchema: {
            type: "object",
            properties: {
                agentId: { type: "string", description: "Agent ID" },
                unreadOnly: { type: "boolean", description: "Only return unread notifications (default: false)" },
            },
            required: ["agentId"],
        },
    },
    // ── Reference data ──
    {
        name: "neutron_get_rate",
        description: "Get current BTC exchange rates against all supported currencies (USD, VND, USDT, etc.).",
        inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
        name: "neutron_get_fiat_institutions",
        description: "List banks and financial institutions for a country. Returns institution codes needed for fiat payouts.",
        inputSchema: {
            type: "object",
            properties: {
                countryCode: { type: "string", description: "ISO country code (e.g. VN, NG, KE, GH)" },
            },
            required: ["countryCode"],
        },
    },
];
// ── Tool handlers ──────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const client = getClient();
    try {
        let result;
        switch (name) {
            // ── Auth ──
            case "neutron_authenticate": {
                const auth = await client.authenticate();
                result = {
                    success: true,
                    accountId: auth.accountId,
                    tokenExpiry: auth.expiredAt,
                    message: "Authentication successful. Your API credentials are valid.",
                };
                break;
            }
            // ── Account ──
            case "neutron_get_account":
                result = await client.getAccount();
                break;
            case "neutron_get_wallets":
                result = await client.getWallets();
                break;
            case "neutron_get_wallet":
                result = await client.getWallet(args.walletId);
                break;
            // ── Create Lightning Invoice ──
            case "neutron_create_lightning_invoice": {
                const { amountSats, amountBtc, memo, extRefId } = args;
                let btcAmount;
                if (amountSats !== undefined) {
                    btcAmount = amountSats / 100_000_000;
                }
                else if (amountBtc !== undefined) {
                    btcAmount = amountBtc;
                }
                else {
                    throw new Error("Provide either amountSats or amountBtc");
                }
                const txn = await client.createTransaction({
                    extRefId,
                    sourceReq: {
                        ccy: "BTC",
                        method: "lightning",
                        reqDetails: {},
                    },
                    destReq: {
                        ccy: "BTC",
                        method: "neutronpay",
                        amtRequested: btcAmount,
                        reqDetails: {},
                    },
                });
                const confirmed = await client.confirmTransaction(txn.txnId);
                const payReq = confirmed.sourceReq?.reqDetails?.paymentRequest;
                const qrPage = confirmed.sourceReq?.reqDetails?.invoicePageUrl;
                result = {
                    success: true,
                    txnId: confirmed.txnId,
                    invoice: payReq,
                    qrPageUrl: qrPage,
                    amountBtc: btcAmount,
                    amountSats: Math.round(btcAmount * 100_000_000),
                    memo: memo || null,
                    status: confirmed.txnState,
                    message: "Lightning invoice created and confirmed. Share the invoice string or QR page URL to receive payment.",
                };
                break;
            }
            // ── Create Transaction ──
            case "neutron_create_transaction": {
                const a = args;
                // Build destination reqDetails
                const destReqDetails = {};
                if (a.paymentRequest)
                    destReqDetails.paymentRequest = a.paymentRequest;
                if (a.lnurl)
                    destReqDetails.lnurl = a.lnurl;
                if (a.address)
                    destReqDetails.address = a.address;
                if (a.bankAcctNum)
                    destReqDetails.bankAcctNum = a.bankAcctNum;
                if (a.institutionCode)
                    destReqDetails.institutionCode = a.institutionCode;
                // Build KYC if fiat payout fields present
                let kyc;
                if (a.recipientName || a.countryCode) {
                    kyc = {
                        type: a.kycType || "individual",
                        details: {
                            legalFullName: a.recipientName,
                            countryCode: a.countryCode,
                        },
                    };
                }
                // Build source of funds for fiat payouts
                let sourceOfFunds;
                if (a.bankAcctNum) {
                    sourceOfFunds = { purpose: 1, source: 5, relationship: 3 };
                }
                const body = {
                    extRefId: a.extRefId,
                    sourceReq: {
                        ccy: a.sourceCcy,
                        method: a.sourceMethod,
                        ...(a.sourceAmount !== undefined ? { amtRequested: a.sourceAmount } : {}),
                        reqDetails: {},
                    },
                    destReq: {
                        ccy: a.destCcy,
                        method: a.destMethod,
                        ...(a.destAmount !== undefined ? { amtRequested: a.destAmount } : {}),
                        reqDetails: destReqDetails,
                        ...(kyc ? { kyc } : {}),
                    },
                    ...(sourceOfFunds ? { sourceOfFunds } : {}),
                };
                result = await client.createTransaction(body);
                break;
            }
            // ── Transaction management ──
            case "neutron_confirm_transaction":
                result = await client.confirmTransaction(args.transactionId);
                break;
            case "neutron_get_transaction":
                result = await client.getTransaction(args.transactionId);
                break;
            case "neutron_list_transactions": {
                const { status, method, currency, fromDate, toDate, limit, offset } = args;
                result = await client.listTransactions({ status, method, currency, fromDate, toDate, limit, offset });
                break;
            }
            // ── Receive addresses ──
            case "neutron_get_btc_address":
                result = await client.getBtcReceiveAddress();
                break;
            case "neutron_get_usdt_address":
                result = await client.getUsdtReceiveAddress(args.chain || "TRON");
                break;
            // ── Webhooks ──
            case "neutron_create_webhook":
                result = await client.createWebhook({
                    callback: args.callback,
                    secret: args.secret,
                });
                break;
            case "neutron_list_webhooks":
                result = await client.listWebhooks();
                break;
            case "neutron_update_webhook": {
                const { webhookId, ...rest } = args;
                result = await client.updateWebhook(webhookId, rest);
                break;
            }
            case "neutron_delete_webhook":
                await client.deleteWebhook(args.webhookId);
                result = { success: true, message: `Webhook ${args.webhookId} deleted.` };
                break;
            // ── Reference data ──
            // ── Lending ──
            case "neutron_lend_simulate":
                result = await lendingRequest("POST", "/api/loans/simulate", {
                    btcAmount: args.btcAmount,
                    ltvRatio: args.ltvRatio,
                });
                break;
            case "neutron_lend_quote":
                result = await lendingRequest("POST", "/api/loans/quote", {
                    agentId: args.agentId,
                    btcAmount: args.btcAmount,
                    ltvRatio: args.ltvRatio,
                });
                break;
            case "neutron_lend_create": {
                // Step 1: Create loan
                const loanPayload = {
                    agentId: args.agentId,
                    btcAmount: args.btcAmount,
                    ltvRatio: args.ltvRatio,
                    returnAddress: args.returnAddress,
                    usdtReceiveAddress: args.usdtReceiveAddress,
                };
                if (args.quoteId)
                    loanPayload.quoteId = args.quoteId;
                const loan = await lendingRequest("POST", "/api/loans", loanPayload);
                // Step 2: If borrowerPubkey provided, create DLC contract with real multisig
                if (args.borrowerPubkey && loan.id) {
                    try {
                        const dlc = await lendingRequest("POST", "/api/dlc/contracts", {
                            loanId: loan.id,
                            borrowerPubkey: args.borrowerPubkey,
                            collateralSats: Math.round(args.btcAmount * 1e8),
                            liquidationPrice: loan.liquidationPrice,
                            returnAddress: args.returnAddress,
                        });
                        loan.dlcContractId = dlc.contractId;
                        loan.depositAddress = dlc.multisig?.address || dlc.depositAddress;
                        loan.multisig = dlc.multisig;
                        loan.explorer = { ...loan.explorer, multisigAddress: dlc.explorer?.multisigAddress };
                    }
                    catch (e) {
                        loan.dlcError = e.message || "Failed to create DLC contract";
                    }
                }
                result = loan;
                break;
            }
            case "neutron_lend_confirm_collateral":
                result = await lendingRequest("POST", `/api/loans/${args.loanId}/confirm-collateral`, {
                    btcDepositTxid: args.btcDepositTxid,
                    confirmations: args.confirmations,
                });
                break;
            case "neutron_lend_disburse":
                result = await lendingRequest("POST", `/api/loans/${args.loanId}/disburse`);
                break;
            case "neutron_lend_status": {
                const loan = await lendingRequest("GET", `/api/loans/${args.loanId}`);
                // Fetch DLC contract for verification links
                let dlcInfo = null;
                try {
                    dlcInfo = await lendingRequest("GET", `/api/dlc/contracts/by-loan/${args.loanId}`);
                }
                catch { /* no DLC contract */ }
                result = {
                    ...loan,
                    ...(dlcInfo ? {
                        dlcContract: {
                            status: dlcInfo.status,
                            multisig: dlcInfo.multisig,
                            depositAddress: dlcInfo.depositAddress,
                            fundingTxid: dlcInfo.fundingTxid,
                            verification: {
                                multisigAddress: dlcInfo.depositAddress ? `https://mempool.space/address/${dlcInfo.depositAddress}` : null,
                                fundingTransaction: dlcInfo.fundingTxid && dlcInfo.fundingTxid !== 'pending' ? `https://mempool.space/tx/${dlcInfo.fundingTxid}` : null,
                                note: "Share these links as proof that BTC collateral is locked in a 2-of-3 multisig and cannot be moved without 2 key holders signing.",
                            },
                        },
                    } : {}),
                };
                break;
            }
            case "neutron_lend_repay":
                result = await lendingRequest("POST", `/api/loans/${args.loanId}/repay`, {
                    usdtAmount: args.usdtAmount,
                    ethTxid: args.ethTxid,
                    fromAddress: args.fromAddress,
                });
                break;
            case "neutron_lend_list":
                result = await lendingRequest("GET", `/api/loans?agent_id=${args.agentId}`);
                break;
            case "neutron_lend_rollover":
                if (!args.acceptTerms) {
                    throw new Error("Terms not accepted. You must present rollover terms to the user first: $500 flat fee, +1% interest rate increase, 1-year extension, non-refundable. Set acceptTerms=true only after explicit user confirmation.");
                }
                result = await lendingRequest("POST", `/api/loans/${args.loanId}/rollover`);
                break;
            case "neutron_lend_check_liquidation":
                result = await lendingRequest("POST", `/api/loans/${args.loanId}/liquidation-check`);
                break;
            case "neutron_lend_btc_price":
                result = await lendingRequest("GET", "/api/loans/admin/price");
                break;
            case "neutron_lend_settle": {
                // Get loan to verify it's repaid
                const settleLoan = await lendingRequest("GET", `/api/loans/${args.loanId}`);
                if (settleLoan.status !== 'repaid') {
                    throw new Error(`Loan status is '${settleLoan.status}' — must be 'repaid' to settle. Remaining owed: $${settleLoan.remainingOwed || 'unknown'}`);
                }
                // Get DLC contract for this loan
                const dlcForSettle = await lendingRequest("GET", `/api/dlc/contracts/by-loan/${args.loanId}`);
                if (!dlcForSettle || !dlcForSettle.contractId) {
                    throw new Error("No DLC contract found for this loan. Cannot settle without multisig.");
                }
                // Trigger settlement — builds, signs with 2-of-3, and broadcasts
                const settlement = await lendingRequest("POST", `/api/dlc/contracts/${dlcForSettle.contractId}/settle`);
                result = {
                    success: true,
                    loanId: args.loanId,
                    contractId: dlcForSettle.contractId,
                    settlementTxid: settlement.txid || settlement.settlementTxid,
                    returnAddress: settleLoan.returnAddress,
                    explorer: settlement.txid ? `https://mempool.space/testnet4/tx/${settlement.txid}` : null,
                    message: "BTC collateral released from multisig back to borrower. Settlement transaction broadcast to network.",
                };
                break;
            }
            case "neutron_lend_notifications": {
                const unread = args.unreadOnly ? '?unread=true' : '';
                result = await lendingRequest("GET", `/api/notifications/agent/${args.agentId}${unread}`);
                break;
            }
            // ── Reference data ──
            case "neutron_get_rate":
                result = await client.getRate();
                break;
            case "neutron_get_fiat_institutions":
                result = await client.getFiatInstitutions(args.countryCode);
                break;
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
});
// ── Start ──────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Neutron MCP Server v1.3.0 running on stdio");
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map