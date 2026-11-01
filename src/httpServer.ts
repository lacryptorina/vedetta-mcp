/**
 * httpServer.ts — hosted mode for vedetta-mcp.
 *
 * Streamable HTTP transport over plain node:http (no framework dep). Every
 * MCP session request must carry `Authorization: Bearer <ledger-token>`.
 * Tokens map to a credit balance; each successful paid call debits
 * price + markup. Self-serve prepaid packs:
 *   GET /mcp/subscribe?pack=…  (public x402)
 *   GET /mcp/topup?amount_usd=… (Bearer + x402)
 *   GET /mcp/subscription      (Bearer status)
 */
import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Ledger } from "./ledger.js";
import { buildMcpServer, ROUTES, BASE_URL } from "./routes.js";
import {
  createSubscribeRuntime,
  handlePaidSubscribeRoute,
  handleSubscriptionStatus,
  type SubscribeRuntime,
} from "./subscribe.js";
import { listPacks } from "./packs.js";

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

function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

export async function startHttpServer(opts: HttpOptions): Promise<void> {
  const { port, ledger, markupPct } = opts;
  const sessions = new Map<string, Session>();

  let subscribeRuntime: SubscribeRuntime | null = null;
  let subscribeInitError: string | null = null;
  try {
    subscribeRuntime = await createSubscribeRuntime(markupPct);
  } catch (err) {
    subscribeInitError = err instanceof Error ? err.message : String(err);
    console.error(`vedetta-mcp: subscribe x402 init failed — ${subscribeInitError}`);
    console.error("  GET /mcp/subscribe|/topup will return 503 until facilitator is reachable.");
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = pathnameOf(req);

      // --- health (public — no auth; used by uptime monitors via /mcp-health) ---
      if (req.method === "GET" && (path === "/health" || path === "/mcp-health")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            service: "vedetta-mcp",
            version: "2.1.0",
            tool_count: Object.keys(ROUTES).length,
            packs: listPacks().map(p => ({
              id: p.id,
              price_usd: p.priceUsd,
              credits_usd: p.creditsUsd,
            })),
            subscribe: subscribeRuntime
              ? { ready: true }
              : { ready: false, error: subscribeInitError },
          }),
        );
        return;
      }

      // --- subscription status (Bearer) --------------------------------------
      if (await handleSubscriptionStatus(req, res, ledger, markupPct)) return;

      // --- subscribe / topup (public x402; topup still needs Bearer) ----------
      if (path === "/mcp/subscribe" || path === "/subscribe" || path === "/mcp/topup" || path === "/topup") {
        if (!subscribeRuntime) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Subscribe rail unavailable",
              detail: subscribeInitError,
            }),
          );
          return;
        }
        await handlePaidSubscribeRoute(req, res, ledger, subscribeRuntime);
        return;
      }

      // --- auth (MCP session paths) ------------------------------------------
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (!token || !ledger.get(token)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Unauthorized: valid Bearer token required.",
            hint: "Buy credits: GET /mcp/subscribe?pack=starter|pro|desk (x402 ExactEvm on Base).",
          }),
        );
        return;
      }

      // --- MCP path -------------------------------------------------------------
      if (req.method === "POST" && (path === "/mcp" || path === "/")) {
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

      if (req.method === "DELETE" && (path === "/mcp" || path === "/")) {
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
      res.end(
        JSON.stringify({
          error: "Not found. Use POST /mcp, GET /health, GET /mcp/subscribe|topup|subscription.",
        }),
      );
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
  console.error(
    `  packs: subscribe ${subscribeRuntime ? "READY" : "DOWN"} → GET /mcp/subscribe?pack=starter|pro|desk`,
  );
}
