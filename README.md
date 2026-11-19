# [vedetta-mcp](https://vedetta.dethboy.com)

[![smithery badge](https://smithery.ai/badge/lacryptorina/vedetta-mcp)](https://smithery.ai/servers/lacryptorina/vedetta-mcp)

Pay-per-call market intelligence for MCP clients (Claude, Cursor, Gemini CLI, Cline, and others).

Vedetta sells crypto sentiment reads, sentiment-vs-price divergence verdicts, and live analyst answers over x402 — USDC on Base, one micropayment per paid request. No signup, no API key on paid routes: payment is authentication.

**Live wire prices (authoritative — unpaid 402 / free GET, repriced 2026-11-19):** FREE tool (`200 OK`, IP rate-limited): `track-record` only. Cached `feed` / `snapshot` / `history` / `screener` / `route` / `korra-calls` / `korra-news` / `korra-lean` at **$0.01** (`maxAmountRequired=10000`); 14 live desk routes at **$0.05** (`50000`). Hosted `/mcp` (if used) stays Bearer-token gated.

This package is a **stdio MCP server**. You bring a dedicated low-balance wallet (`EVM_PRIVATE_KEY`) for paid tools. The server settles each micropayment locally. Payment settles only on a successful answer — a failed call costs nothing. Free tools never require a wallet. Directory inspectors (Glama / Smithery) get all **23** tools from `tools/list` with empty env.

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

Start with the FREE audit log + a $0.01 cache check, then decide whether a paid live read is worth it.

```
vedetta_track-record
  asset: BTC

vedetta_snapshot
  asset: BTC
```

Same over HTTP — `track-record` returns **200**; the $0.01 cached routes return **402** with the live offer:

```bash
curl -sS "https://vedetta.dethboy.com/v1/route?task=btc+sentiment"
curl -sS "https://vedetta.dethboy.com/v1/track-record?asset=BTC"
curl -sS "https://vedetta.dethboy.com/v1/korra/calls?asset=BTC"
curl -sS "https://vedetta.dethboy.com/v1/korra/news?asset=BTC"
curl -sS "https://vedetta.dethboy.com/v1/korra/lean?asset=BTC"
```

Cheapest paid path: funnel `vedetta_snapshot`/$0.01 → `vedetta_history` ($0.01) / `vedetta_screener` ($0.01) → live `vedetta_consensus` / `vedetta_ask` ($0.05).

## Price table

Live unpaid **402** `maxAmountRequired` is authoritative for paid routes (atomic USDC, 6 decimals). Server refuses any offer above the listed cap. Free tools never pay.

| Tool | What it does | Price | Latency |
|---|---|---|---|
| `vedetta_route` | Task → endpoint router | $0.01 | instant |
| `vedetta_track-record` | Verifiable call log | **FREE** | instant |
| `vedetta_korra-calls` | Korra open/resolved calls (open_calls redacted) | $0.01 | instant |
| `vedetta_korra-news` | Korra scored news | $0.01 | instant |
| `vedetta_korra-lean` | Korra lean gauges (non-FEAR_GREED teaser) | $0.01 | instant |
| `vedetta_feed` | Desk post stream | $0.01 | instant |
| `vedetta_snapshot` | Cached signal + staleness | $0.01 | instant |
| `vedetta_history` | Signal time-series | $0.01 | instant |
| `vedetta_screener` | Cross-asset divergence scan | $0.01 | instant |
| `vedetta_ask` | Live analyst answer | $0.05 | 10–180 s |
| `vedetta_consensus` | Sentiment-vs-price verdict | $0.05 | 10–180 s |
| `vedetta_prediction` | Falsifiable claim + falsifier | $0.05 | 10–180 s |

Other live desks (`equity`, `macro`, `pulse`, `theme`, `trend`, `news-read`, `house-view`, `event`, `odds`, `social`, `narrative`) are $0.05. Full catalog: https://vedetta.dethboy.com/registry.json

## Publish (registry)

Dry-run (default — never publishes):

```bash
npm run publish:registry
# or: bash scripts/publish_mcp_registry.sh
```

Live publish (Josef only):

```bash
bash scripts/publish_mcp_registry.sh --execute
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `EVM_PRIVATE_KEY` | no | — | Hex private key for Base USDC x402 on **paid** tools |
| `VEDETTA_API_URL` | no | `https://vedetta.dethboy.com` | API base override |
| `VEDETTA_MAX_PRICE_USD` | no | per-route cap | Global price-cap override in USD |

## License

MIT
