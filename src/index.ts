#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { NeutronClient } from "./neutron-client.js";

// ── Singleton client (reuses auth token across tool calls) ─

let _client: NeutronClient | null = null;

function getClient(): NeutronClient {
  if (_client) return _client;

  const apiUrl = process.env.NEUTRON_API_URL || "https://api.neutron.me";
  const apiKey = process.env.NEUTRON_API_KEY;
  const apiSecret = process.env.NEUTRON_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "NEUTRON_API_KEY and NEUTRON_API_SECRET environment variables are required. " +
      "Get your credentials at https://neutron.me"
    );
  }

  _client = new NeutronClient({ apiUrl, apiKey, apiSecret });
  return _client;
}

// ── MCP server ─────────────────────────────────────────────

const server = new Server(
  { name: "neutron-mcp-server", version: "1.1.1" },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ───────────────────────────────────────

const tools = [
  // ── Authentication ──
  {
    name: "neutron_authenticate",
    description:
      "Verify your Neutron API credentials. Returns your account ID and confirms access is working.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },

  // ── Account ──
  {
    name: "neutron_get_account",
    description:
      "Get account details: display name, status, country, timezone, and sub-accounts.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "neutron_get_wallets",
    description:
      "List all wallets with balances. Shows each currency (BTC, USDT, fiat) with total and available balance.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "neutron_get_wallet",
    description: "Get a specific wallet by ID. Shows balance, available balance, and currency.",
    inputSchema: {
      type: "object" as const,
      properties: {
        walletId: { type: "string", description: "Wallet ID (e.g. wal_btc_001)" },
      },
      required: ["walletId"],
    },
  },

  // ── Create Lightning Invoice (receive) ──
  {
    name: "neutron_create_lightning_invoice",
    description:
      `Create a Lightning invoice to receive Bitcoin. Returns a BOLT11 payment request and QR code page.

Examples:
- Receive 10,000 sats: amountSats=10000
- Receive 0.001 BTC: amountBtc=0.001
- With tracking: amountSats=5000, extRefId="order-123"`,
    inputSchema: {
      type: "object" as const,
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
    description:
      `Create a transaction. Supports all payment types:

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
      type: "object" as const,
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
    description:
      "Confirm a quoted transaction to execute it. Call this after neutron_create_transaction.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transactionId: { type: "string", description: "Transaction ID (txnId) to confirm" },
      },
      required: ["transactionId"],
    },
  },
  {
    name: "neutron_get_transaction",
    description:
      "Check transaction status and details. Use to track payment progress after confirmation.",
    inputSchema: {
      type: "object" as const,
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
      type: "object" as const,
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

  // ── Lightning utilities ──
  {
    name: "neutron_decode_invoice",
    description:
      "Decode a BOLT11 Lightning invoice to inspect amount, expiry, destination, and payment status before paying.",
    inputSchema: {
      type: "object" as const,
      properties: {
        invoice: { type: "string", description: "BOLT11 invoice string (starts with lnbc...)" },
      },
      required: ["invoice"],
    },
  },
  {
    name: "neutron_resolve_lightning_address",
    description:
      "Look up a Lightning Address (user@domain.com) to verify it exists and check its parameters (min/max amounts).",
    inputSchema: {
      type: "object" as const,
      properties: {
        address: { type: "string", description: "Lightning Address (e.g. alice@getalby.com)" },
        amountMsat: { type: "number", description: "Optional: amount in millisatoshis to get a specific invoice" },
      },
      required: ["address"],
    },
  },
  {
    name: "neutron_resolve_lnurl",
    description:
      "Resolve an LNURL string to see its type (pay/withdraw/channel) and parameters.",
    inputSchema: {
      type: "object" as const,
      properties: {
        lnurl: { type: "string", description: "LNURL string (starts with lnurl1...)" },
      },
      required: ["lnurl"],
    },
  },

  // ── Receive addresses ──
  {
    name: "neutron_get_btc_address",
    description:
      "Get your Bitcoin on-chain deposit address. Static, reusable SegWit (bc1q...) address.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "neutron_get_usdt_address",
    description:
      "Get your USDT deposit address on TRON (TRC-20) or Ethereum (ERC-20).",
    inputSchema: {
      type: "object" as const,
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
    description:
      "Register a webhook to receive transaction state change notifications. Requires an HTTPS callback URL.",
    inputSchema: {
      type: "object" as const,
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
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "neutron_update_webhook",
    description: "Update a webhook's callback URL or secret.",
    inputSchema: {
      type: "object" as const,
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
      type: "object" as const,
      properties: {
        webhookId: { type: "string", description: "Webhook ID to delete" },
      },
      required: ["webhookId"],
    },
  },

  // ── Reference data ──
  {
    name: "neutron_get_rate",
    description:
      "Get current BTC exchange rates against all supported currencies (USD, VND, USDT, etc.).",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "neutron_get_fiat_institutions",
    description:
      "List banks and financial institutions for a country. Returns institution codes needed for fiat payouts.",
    inputSchema: {
      type: "object" as const,
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
    let result: any;

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
        result = await client.getWallet((args as any).walletId);
        break;

      // ── Create Lightning Invoice ──
      case "neutron_create_lightning_invoice": {
        const { amountSats, amountBtc, memo, extRefId } = args as any;

        let btcAmount: number;
        if (amountSats !== undefined) {
          btcAmount = amountSats / 100_000_000;
        } else if (amountBtc !== undefined) {
          btcAmount = amountBtc;
        } else {
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
        const a = args as any;

        // Build destination reqDetails
        const destReqDetails: Record<string, any> = {};
        if (a.paymentRequest) destReqDetails.paymentRequest = a.paymentRequest;
        if (a.lnurl) destReqDetails.lnurl = a.lnurl;
        if (a.address) destReqDetails.address = a.address;
        if (a.bankAcctNum) destReqDetails.bankAcctNum = a.bankAcctNum;
        if (a.institutionCode) destReqDetails.institutionCode = a.institutionCode;

        // Build KYC if fiat payout fields present
        let kyc: any;
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
        let sourceOfFunds: any;
        if (a.bankAcctNum) {
          sourceOfFunds = { purpose: 1, source: 5, relationship: 3 };
        }

        const body: any = {
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
        result = await client.confirmTransaction((args as any).transactionId);
        break;

      case "neutron_get_transaction":
        result = await client.getTransaction((args as any).transactionId);
        break;

      case "neutron_list_transactions": {
        const { status, method, currency, fromDate, toDate, limit, offset } = args as any;
        result = await client.listTransactions({ status, method, currency, fromDate, toDate, limit, offset });
        break;
      }

      // ── Lightning utilities ──
      case "neutron_decode_invoice":
        result = await client.decodeInvoice((args as any).invoice);
        break;

      case "neutron_resolve_lightning_address":
        result = await client.resolveLightningAddress((args as any).address, (args as any).amountMsat);
        break;

      case "neutron_resolve_lnurl":
        result = await client.resolveLnurl((args as any).lnurl);
        break;

      // ── Receive addresses ──
      case "neutron_get_btc_address":
        result = await client.getBtcReceiveAddress();
        break;

      case "neutron_get_usdt_address":
        result = await client.getUsdtReceiveAddress((args as any).chain || "TRON");
        break;

      // ── Webhooks ──
      case "neutron_create_webhook":
        result = await client.createWebhook({
          callback: (args as any).callback,
          secret: (args as any).secret,
        });
        break;

      case "neutron_list_webhooks":
        result = await client.listWebhooks();
        break;

      case "neutron_update_webhook": {
        const { webhookId, ...rest } = args as any;
        result = await client.updateWebhook(webhookId, rest);
        break;
      }

      case "neutron_delete_webhook":
        await client.deleteWebhook((args as any).webhookId);
        result = { success: true, message: `Webhook ${(args as any).webhookId} deleted.` };
        break;

      // ── Reference data ──
      case "neutron_get_rate":
        result = await client.getRate();
        break;

      case "neutron_get_fiat_institutions":
        result = await client.getFiatInstitutions((args as any).countryCode);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
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
  console.error("Neutron MCP Server v1.1.4 running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
