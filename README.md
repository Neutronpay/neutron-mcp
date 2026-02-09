# Neutron MCP Server

[![npm version](https://img.shields.io/npm/v/neutron-mcp.svg)](https://www.npmjs.com/package/neutron-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Add Bitcoin Lightning payments to any AI-powered app in 2 minutes. This MCP server connects [Neutron's payment API](https://docs.neutron.me) to Claude, Cursor, Windsurf, and any MCP-compatible client.

## Setup (2 minutes)

### 1. Get API Keys

Sign up at [portal.neutron.me](https://portal.neutron.me) → API Keys.

### 2. Add to Your AI Tool

Paste this config into your tool of choice:

```json
{
  "mcpServers": {
    "neutron": {
      "command": "npx",
      "args": ["-y", "neutron-mcp"],
      "env": {
        "NEUTRON_API_KEY": "your_api_key",
        "NEUTRON_API_SECRET": "your_api_secret"
      }
    }
  }
}
```

**Where to paste:**

| Tool | Config File |
|------|-------------|
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| **Claude Code** | `~/.claude.json` or project `.mcp.json` |
| **Cursor** | `.cursor/mcp.json` in your project |
| **Windsurf** | Windsurf MCP settings |
| **Cline (VS Code)** | Cline MCP settings |

### 3. Start Using

Ask your AI assistant:

> "Check my Neutron wallet balances"

That's it. You're connected.

---

## What Can It Do?

### Accept Payments

> "Create a Lightning invoice for 50,000 sats"

Your AI creates the invoice, returns the payment string and QR code page. Customer pays instantly.

### Send Payments

> "Send 10,000 sats to alice@getalby.com"

> "Pay this Lightning invoice: lnbc100u1p..."

> "Send 0.01 BTC to bc1qxy2kgd..."

### Manage Treasury

> "Show all wallet balances"

> "Convert 0.005 BTC to USDT"

> "What's the current BTC/USD rate?"

### Fiat Payouts

> "Look up bank codes for Vietnam"

> "Send 500,000 VND to bank account 0123456789 at institution 970422"

### Webhooks

> "Set up a webhook at https://myapp.com/payments with secret my-secret-key"

---

## All 20 Tools

### Account
| Tool | What It Does |
|------|-------------|
| `neutron_authenticate` | Verify API credentials |
| `neutron_get_account` | Account info and status |
| `neutron_get_wallets` | All wallet balances |
| `neutron_get_wallet` | Specific wallet by ID |

### Payments
| Tool | What It Does |
|------|-------------|
| `neutron_create_lightning_invoice` | Generate Lightning invoice to receive BTC (auto-confirms) |
| `neutron_create_transaction` | Create any payment: Lightning, on-chain, USDT, fiat |
| `neutron_confirm_transaction` | Confirm a quoted transaction to execute it |
| `neutron_get_transaction` | Check transaction status |
| `neutron_list_transactions` | List/filter transaction history |

### Lightning Utilities
| Tool | What It Does |
|------|-------------|
| `neutron_decode_invoice` | Inspect a BOLT11 invoice (amount, expiry, status) |
| `neutron_resolve_lightning_address` | Verify a Lightning Address (user@domain.com) |
| `neutron_resolve_lnurl` | Decode an LNURL string |

### Receive Addresses
| Tool | What It Does |
|------|-------------|
| `neutron_get_btc_address` | Get your Bitcoin on-chain deposit address |
| `neutron_get_usdt_address` | Get your USDT deposit address (TRON or Ethereum) |

### Webhooks
| Tool | What It Does |
|------|-------------|
| `neutron_create_webhook` | Register webhook for payment notifications |
| `neutron_list_webhooks` | List registered webhooks |
| `neutron_update_webhook` | Update webhook URL or secret |
| `neutron_delete_webhook` | Remove a webhook |

### Reference
| Tool | What It Does |
|------|-------------|
| `neutron_get_rate` | BTC exchange rates (USD, VND, USDT, etc.) |
| `neutron_get_fiat_institutions` | Bank codes by country (for fiat payouts) |

---

## Key Concepts

- **Amounts are in BTC**, not satoshis. 10,000 sats = `0.0001` BTC.
- **Two-step flow**: `create_transaction` returns a quote → `confirm_transaction` executes it.
- **Set amount on one side only** — source OR destination, not both.
- **`create_lightning_invoice`** is a shortcut that auto-confirms (no second step needed).
- **Fiat payouts require KYC** (recipient name + country). Lightning and crypto do not.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEUTRON_API_KEY` | Yes | Your Neutron API key |
| `NEUTRON_API_SECRET` | Yes | Your Neutron API secret |
| `NEUTRON_API_URL` | No | API URL (default: `https://api.neutron.me`) |

---

## Example: Add Payments to a Web App

Ask your AI assistant:

> "Help me add Bitcoin payments to my Next.js checkout. When a user clicks Pay, create a Lightning invoice for the cart total, show a QR code, and redirect to a success page when the webhook fires."

The AI uses `neutron_create_lightning_invoice` for the invoice, `neutron_create_webhook` for notifications, and writes the frontend + backend code — all in one conversation.

---

## Links

- **Docs**: [docs.neutron.me](https://docs.neutron.me)
- **API Reference**: [docs.neutron.me/reference](https://docs.neutron.me/reference/overview)
- **MCP Guide**: [docs.neutron.me/docs/mcp-for-ai-agents](https://docs.neutron.me/docs/mcp-for-ai-agents)
- **Issues**: [GitHub](https://github.com/Neutronpay/neutron-mcp/issues)
- **Contact**: support@neutron.me

---

## License

MIT
