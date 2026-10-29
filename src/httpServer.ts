/**
 * httpServer.ts — hosted mode for vedetta-mcp.
 *
 * Streamable HTTP transport over plain node:http (no framework dep). Every
 * request must carry `Authorization: Bearer <ledger-token>`. Tokens map to a
 * credit balance; each successful paid call debits price + markup. One
 * McpServer instance per session (SDK pattern), sessions keyed by id.
 */
import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Ledger } from "./ledger.js";
import { buildMcpServer, ROUTES, RouteSpec, GLOBAL_CAP_USD, BASE_URL, DISCLAIMER } from "./routes.js";

export interface HttpOptions {
  port: number;
  ledger: Ledger;
  markupPct: number; // debited price = listed price * (1 + markup/100)
  host?: string;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  token: string;
  server: McpServer;
}

export async function startHttpServer(opts: HttpOptions): Promise<void> {
  const { port, ledger, markupPct } = opts;
  const sessions = new Map<string, Session>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // --- health (public — no auth; used by uptime monitors via /mcp-health) ---
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "vedetta-mcp", tool_count: Object.keys(ROUTES).length }));
        return;
      }

      // --- auth -----------------------------------------------------------------
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (!token || !ledger.get(token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized: valid Bearer token required. See ledger issue." }));
        return;
      }
      const rec = ledger.get(token)!;

      // --- MCP path -------------------------------------------------------------
      if (req.method === "POST" && req.url === "/mcp") {
        const sessionId = String(req.headers["mcp-session-id"] || "");
        let session: Session | undefined = sessions.get(sessionId);

        if (!session) {
          // Session id is generated lazily inside handleRequest; pre-generate it
          // so we can key the map before the first request completes.
          const sid = randomUUID();
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sid,
          });
          const serverMcp = buildMcpServer({ ledger, token, markupPct });
          await serverMcp.connect(transport);
          session = { transport, token, server: serverMcp };
          transport.onclose = () => {
            sessions.delete(sid);
            serverMcp.close().catch(() => {});
          };
          sessions.set(sid, session);
        }

        // token must match the session's token
        if (session.token !== token) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized: token mismatch for this session" }));
          return;
        }

        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method === "DELETE" && req.url === "/mcp") {
        const sessionId = String(req.headers["mcp-session-id"] || "");
        const session = sessions.get(sessionId);
        if (session) {
          await session.transport.close();
          sessions.delete(sessionId);
        }
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use POST /mcp (Streamable HTTP), GET /health." }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Internal error: ${msg}` }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, opts.host || "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  console.error(`vedetta-mcp HTTP running on http://${opts.host || "127.0.0.1"}:${port}/mcp`);
  console.error(`  base: ${BASE_URL} | routes: ${Object.keys(ROUTES).length} | markup: ${markupPct}%`);
  console.error(`  ledger: ${process.env.VEDETTA_LEDGER_PATH || "~/.vedetta-mcp/ledger.json"}`);
}
