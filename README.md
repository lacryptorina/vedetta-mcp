# [vedetta-mcp](https://vedetta.dethboy.com)

[![smithery badge](https://smithery.ai/badge/lacryptorina/vedetta-mcp)](https://smithery.ai/servers/lacryptorina/vedetta-mcp)

Pay-per-call market intelligence for MCP clients (Claude, Cursor, Gemini CLI, Cline, and others).

Vedetta sells crypto sentiment reads, sentiment-vs-price divergence verdicts, and live analyst answers over x402 — USDC on Base, one micropayment per paid request. No signup, no API key on paid routes: payment is authentication.

**Product shape (gateway 2.13.0):** four funnel tools are **FREE** (`200 OK`, IP rate-limited): `feed`, `route`, `snapshot`, `track-record`. Sixteen analytical tools are paid via x402 (**$0.01–$0.09**). Hosted `/mcp` is Bearer-token gated; self-serve prepaid packs (when the host runs `--http` with a facilitator) are `GET /mcp/subscribe?pack=starter|pro|desk` at **$5 / $25 / $100** USDC on Base → credits **$5 / $26 / $110**, then top-up `GET /mcp/topup?amount_usd=N` (≥$5, 1:1).

This package is a **stdio MCP server**. You bring a dedicated low-balance wallet (`EVM_PRIVATE_KEY`) for paid tools. The server settles each micropayment locally. Payment settles only on a successful answer — a failed call costs nothing. Free tools never require a wallet. Directory inspectors (Glama / Smithery) get all **20** tools from `tools/list` with empty env.

**Descriptive market analysis only — not financial advice.**

Site: https://vedetta.dethboy.com · OpenAPI: https://vedetta.dethboy.com/openapi.json · Agent card: https://vedetta.dethboy.com/vedetta.md

## Install

Node 20+. Wallet needs USDC on Base only for paid tools. A few dollars covers hundreds of calls.

One-liner (no wallet — free funnel works; paid tools return the 402 offer):

```bash
npx -y vedetta-mcp@latest
```

Claude Code:

```bash
claude mcp add vedetta -e EVM_PRIVATE_KEY=0xYOUR_KEY -- npx -y vedetta-mcp@latest
```

Claude Desktop / Cursor (`claude_desktop_config.json` or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "vedetta": {
      "command": "npx",
      "args": ["-y", "vedetta-mcp@latest"],
      "env": { "EVM_PRIVATE_KEY": "0xYOUR_KEY" }
    }
  }
}
```

Gemini CLI: clone/install this repo as an extension (`gemini-extension.json`). Cline Marketplace: see `llms-install.md`. Cursor plugin: `.cursor-plugin/plugin.json` + `mcp.json`.

Without `EVM_PRIVATE_KEY` the server still starts — free tools work; paid tools return the live 402 offer so you can inspect cost before funding a wallet. The key never leaves your machine.

## Worked example

Start free: audit + cache check, then decide whether a paid live read is worth it.

```
vedetta_track-record
  asset: BTC

vedetta_snapshot
  asset: BTC
```

Same over HTTP (free funnel returns **200**):

```bash
curl -sS "https://vedetta.dethboy.com/v1/track-record?asset=BTC"
curl -sS "https://vedetta.dethboy.com/v1/snapshot?asset=BTC"
```

Cheapest paid path: `vedetta_history` ($0.01) / `vedetta_screener` ($0.03) → live `vedetta_consensus` / `vedetta_ask` ($0.09).

## Price table

Live 402 offer is authoritative for paid routes. Server refuses any offer above the listed cap. Free tools never pay.

| Tool | What it does | Price | Latency |
|---|---|---|---|
| `vedetta_feed` | Desk post stream | **FREE** | instant |
| `vedetta_route` | Task → endpoint router | **FREE** | instant |
| `vedetta_snapshot` | Cached signal + staleness | **FREE** | instant |
| `vedetta_track-record` | Verifiable call log | **FREE** | instant |
| `vedetta_history` | Signal time-series | $0.01 | instant |
| `vedetta_screener` | Cross-asset divergence scan | $0.03 | instant |
| `vedetta_ask` | Live analyst answer | $0.09 | 10–180 s |
| `vedetta_consensus` | Sentiment-vs-price verdict | $0.09 | 10–180 s |
| `vedetta_prediction` | Falsifiable claim + falsifier | $0.09 | 10–180 s |

Other live desks (`equity`, `macro`, `pulse`, `theme`, `trend`, `news-read`, `house-view`, `event`, `odds`, `social`, `narrative`) are $0.09. Full catalog: https://vedetta.dethboy.com/registry.json

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `EVM_PRIVATE_KEY` | no | — | Hex private key for Base USDC x402 on **paid** tools (stdio buyer **or** hosted float that pays the gateway) |
| `VEDETTA_API_URL` | no | `https://vedetta.dethboy.com` | API base override |
| `VEDETTA_MAX_PRICE_USD` | no | per-route cap | Global price-cap override in USD |
| `VEDETTA_MARKUP_PCT` | hosted | `30` | Debit = listed × (1 + markup/100) on paid tools only |
| `VEDETTA_PAY_TO` | hosted packs | Base OG `0x21E1…2eFA` | Subscribe/top-up receive address — never ACP/FluxA |
| `X402_FACILITATOR_URL` | hosted packs | PayAI facilitator | ExactEvm verify/settle for subscribe/top-up |

## License

MIT
