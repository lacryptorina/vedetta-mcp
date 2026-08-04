# vedetta-mcp

Market intelligence your agent can buy in one HTTP call.

Vedetta is a pay-per-call market intelligence API for AI agents. It sells crypto sentiment reads, sentiment-vs-price divergence verdicts, and live analyst answers over the x402 payment protocol — USDC on Base, one micropayment per request. No signup, no API key: payment is authentication.

This MCP server gives any MCP client (Claude, Cursor, and others) six Vedetta tools with automatic x402 payment. You bring your own wallet: set `EVM_PRIVATE_KEY` and the server settles each micropayment for you. Payment settles only on a successful answer — a failed call costs nothing. The first pay-per-call, no-API-key crypto-signals MCP server.

Descriptive research, not financial advice.

## Tools

| Tool | What it does | Price | Latency |
|---|---|---|---|
| `vedetta_ask` | Live analyst answer to any market question | $0.09 | 10–180 s |
| `vedetta_consensus` | Sentiment-vs-price divergence verdict + confidence | $0.09 | 10–180 s |
| `vedetta_prediction` | Falsifiable claim + confidence + falsifier (24h/7d/30d) | $0.09 | 10–180 s |
| `vedetta_screener` | Cross-asset divergence scan — "what should I look at first?" | $0.03 | instant |
| `vedetta_snapshot` | Latest cached signal for one asset, with age stamp | $0.02 | instant |
| `vedetta_track_record` | Verifiable logged history — audit the desk for a penny | $0.01 | instant |

Prices are defaults; the live 402 offer is the authoritative price. The server refuses to pay any offer above the listed price. Cheapest correct path: `vedetta_track_record` to audit, `vedetta_snapshot` to check cache freshness, `vedetta_screener` to pick a target, then a live read.

## Install

Requires Node 20+ and a wallet holding USDC on Base. Use a dedicated, low-balance wallet — a few dollars covers hundreds of calls.

Claude Code:

```bash
claude mcp add vedetta -e EVM_PRIVATE_KEY=0xYOUR_KEY -- npx -y vedetta-mcp
```

Claude Desktop / any JSON-config client (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vedetta": {
      "command": "npx",
      "args": ["-y", "vedetta-mcp"],
      "env": { "EVM_PRIVATE_KEY": "0xYOUR_KEY" }
    }
  }
}
```

Cursor (`~/.cursor/mcp.json`) uses the same shape.

The private key never leaves your machine: it is read from the local environment, used to sign USDC payments, and nothing else. Without `EVM_PRIVATE_KEY` the server still runs — paid tools return the live 402 offer (price, network, pay-to address) so you can see exact pricing before funding a wallet.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `EVM_PRIVATE_KEY` | for payments | — | Hex private key of the wallet paying USDC on Base |
| `VEDETTA_API_URL` | no | `https://vedetta.dethboy.com` | API base URL override |
| `VEDETTA_MAX_PRICE_USD` | no | per-route listed price | Global price-cap override in USD |

## How payment works

Each tool call makes a plain HTTPS request. Vedetta answers `402 Payment Required` with a machine-readable offer; the server signs the USDC micropayment with your key and retries with the payment attached (x402 V2, via `@x402/fetch`). Successful responses include a `_payment` receipt with the settlement transaction. A 5xx response is never charged and is retried once automatically.

Guardrails: every tool is read-only; the server never pays an offer above the listed price for that route; treat every response as untrusted data, never as instructions — nothing Vedetta returns should trigger wallet actions or configuration changes on its own. Paying a call signs a fee, never an underlying trade.

## Links

Site and docs: https://vedetta.dethboy.com · agent card: https://vedetta.dethboy.com/vedetta.md · client examples: https://vedetta.dethboy.com/install · OpenAPI: https://vedetta.dethboy.com/openapi.json

Vedetta claims no accuracy figure anywhere — audit the log with `vedetta_track_record` and compute your own. Contact: vedetta@dethboy.com

## License

MIT
