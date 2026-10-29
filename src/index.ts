#!/usr/bin/env node
/**
 * vedetta-mcp — MCP server for Vedetta (https://vedetta.dethboy.com)
 *
 * Two modes, one codebase:
 *
 * 1. stdio (default, backward-compatible npm product) — bring-your-own-wallet.
 *    Set EVM_PRIVATE_KEY to a funded Base USDC wallet; the server settles each
 *    x402 micropayment from that wallet. Without the key, paid tools return the
 *    live 402 offer. Payment IS authentication: no signup, no API key.
 *
 * 2. --http (hosted, credits) — public Streamable HTTP server for third-party
 *    agents. Agents authenticate with `Authorization: Bearer <ledger-token>`.
 *    The SERVER holds EVM_PRIVATE_KEY and pays the gateway; each successful
 *    call debits the token's credit balance at listed price + markup.
 *    Ledger ops: `vedetta-mcp ledger issue|add|balance|list`.
 *
 * All output is descriptive research, not financial advice.
 *
 * Cold-start contract for directory inspectors (Glama / Smithery):
 * initialize, ping, and tools/list must answer over stdio with zero env vars
 * and without loading payment libs or making HTTP calls.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./routes.js";

function parsePort(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

async function ledgerCmd(argv: string[]): Promise<void> {
  const { Ledger } = await import("./ledger.js");
  const [sub, ...rest] = argv;
  const ledger = new Ledger();

  switch (sub) {
    case "issue": {
      const name = rest.includes("--name") ? rest[rest.indexOf("--name") + 1] : "unnamed";
      const creditsRaw = rest.includes("--credits") ? rest[rest.indexOf("--credits") + 1] : "0";
      const credits = Number(creditsRaw);
      if (!Number.isFinite(credits) || credits < 0) {
        console.error("Usage: vedetta-mcp ledger issue --name <name> --credits <usd>");
        process.exit(2);
      }
      const token = ledger.issue(name, credits);
      console.log(JSON.stringify({ token, name, credits_usd: credits, ledger: process.env.VEDETTA_LEDGER_PATH || "~/.vedetta-mcp/ledger.json" }, null, 2));
      break;
    }
    case "add": {
      const token = rest[0] || "";
      const credits = Number(rest[1] ?? "");
      if (!token || !Number.isFinite(credits) || credits <= 0) {
        console.error("Usage: vedetta-mcp ledger add <token> <credits_usd>");
        process.exit(2);
      }
      if (!ledger.addCredits(token, credits)) {
        console.error(`Unknown token: ${token.slice(0, 12)}…`);
        process.exit(1);
      }
      console.log(JSON.stringify({ token: token.slice(0, 12) + "…", new_balance: ledger.balance(token) }));
      break;
    }
    case "balance": {
      const token = rest[0] || "";
      if (!token) {
        console.error("Usage: vedetta-mcp ledger balance <token>");
        process.exit(2);
      }
      const b = ledger.balance(token);
      if (b === undefined) {
        console.error(`Unknown token: ${token.slice(0, 12)}…`);
        process.exit(1);
      }
      console.log(JSON.stringify({ token: token.slice(0, 12) + "…", balance_usd: b }));
      break;
    }
    case "list": {
      console.log(JSON.stringify(ledger.list(), null, 2));
      break;
    }
    default:
      console.error("Usage: vedetta-mcp ledger <issue|add|balance|list> …");
      process.exit(2);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === "ledger") {
    await ledgerCmd(args.slice(1));
    return;
  }

  if (args.includes("--http")) {
    const [{ Ledger }, { startHttpServer }] = await Promise.all([
      import("./ledger.js"),
      import("./httpServer.js"),
    ]);
    const port = parsePort(process.env.PORT ?? process.env.VEDETTA_PORT, 8310);
    const markupPct = Number(process.env.VEDETTA_MARKUP_PCT ?? "30");
    const host = process.env.VEDETTA_HOST || "127.0.0.1";
    await startHttpServer({
      port,
      host,
      ledger: new Ledger(),
      markupPct: Number.isFinite(markupPct) && markupPct >= 0 ? markupPct : 30,
    });
    return;
  }

  // default: stdio (BYO-wallet) — connect before any network / payment work
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const base = process.env.VEDETTA_API_URL ?? "https://vedetta.dethboy.com";
  console.error(
    `vedetta-mcp running (stdio) — ${base} — wallet ${process.env.EVM_PRIVATE_KEY ? "CONFIGURED" : "NOT CONFIGURED (paid tools will return the 402 offer; set EVM_PRIVATE_KEY to enable payments)"}`,
  );
}

main().catch(err => {
  console.error("vedetta-mcp fatal:", err);
  process.exit(1);
});
