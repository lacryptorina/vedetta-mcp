# Install vedetta-mcp in Cline

Add the Vedetta MCP server to Cline. Node.js 20+ is required. **No environment variables are required** for the four FREE funnel tools (`vedetta_feed`, `vedetta_route`, `vedetta_snapshot`, `vedetta_track-record`). Optional buyer env vars unlock the 16 paid x402 tools.

## Cline MCP settings (single block)

Merge this into the existing `mcpServers` object in Cline MCP settings. Do not replace unrelated servers.

```json
{
  "mcpServers": {
    "vedetta": {
      "command": "npx",
      "args": ["-y", "vedetta-mcp@latest"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

## Optional env (paid tools only)

Only needed when you want the server to settle x402 micropayments from a local wallet. Free funnel tools work without these.

| Variable | Required for free tools | Purpose |
|---|---|---|
| `EVM_PRIVATE_KEY` | no | Hex private key for a Base USDC wallet (paid tools settle via x402) |
| `SOLANA_PRIVATE_KEY` | no | Optional Sol buyer key if using Sol rail clients outside this MCP (stdio MCP settles Base today) |
| `VEDETTA_API_URL` | no | Override API base (default `https://vedetta.dethboy.com`) |

Example with optional Base wallet:

```json
{
  "mcpServers": {
    "vedetta": {
      "command": "npx",
      "args": ["-y", "vedetta-mcp@latest"],
      "env": {
        "EVM_PRIVATE_KEY": "0xYOUR_BASE_USDC_WALLET_KEY"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Without `EVM_PRIVATE_KEY`, paid tools still appear in `tools/list` and return the live 402 offer so you can inspect cost before funding a wallet.

Site: https://vedetta.dethboy.com · Descriptive market analysis only — not financial advice.
