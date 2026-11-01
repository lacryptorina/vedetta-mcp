/**
 * subscribe.ts — self-serve MCP prepaid packs via Base ExactEvm x402.
 *
 * Public (no Bearer):
 *   GET /mcp/subscribe?pack=starter|pro|desk  → 402 → mint vd_… Bearer
 *   GET /mcp/topup?amount_usd=N               → 402 → refill (Bearer required)
 * Bearer:
 *   GET /mcp/subscription                    → balance / pack / payer
 *
 * Seller payTo = Base OG 0x21E1… (never ACP/FluxA). Facilitator default PayAI
 * (no CDP keys required); override with X402_FACILITATOR_URL.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import {
  x402HTTPResourceServer,
  decodePaymentSignatureHeader,
  type HTTPAdapter,
  type HTTPRequestContext,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { Ledger } from "./ledger.js";
import {
  MIN_TOPUP_USD,
  NETWORK_BASE,
  PACKS,
  PAY_TO_BASE,
  listPacks,
  packPriceMoney,
  parsePackId,
  parseTopupUsd,
  type PackId,
} from "./packs.js";

export interface SubscribeRuntime {
  httpServer: x402HTTPResourceServer;
  markupPct: number;
  publicBaseUrl: string;
}

function facilitatorUrl(): string {
  return (
    process.env.X402_FACILITATOR_URL?.trim() ||
    process.env.FACILITATOR_URL?.trim() ||
    "https://facilitator.payai.network"
  );
}

function publicBaseUrl(): string {
  return (process.env.VEDETTA_PUBLIC_URL || "https://vedetta.dethboy.com").replace(/\/+$/, "");
}

function queryOne(adapter: HTTPAdapter, name: string): string | undefined {
  const v = adapter.getQueryParam?.(name);
  if (Array.isArray(v)) return v[0];
  return v;
}

function buildAdapter(req: IncomingMessage, url: URL): HTTPAdapter {
  return {
    getHeader: (name: string) => {
      const v = req.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
    getMethod: () => req.method || "GET",
    getPath: () => url.pathname,
    getUrl: () => `${publicBaseUrl()}${url.pathname}${url.search}`,
    getAcceptHeader: () => {
      const v = req.headers.accept;
      return Array.isArray(v) ? v[0] || "*/*" : v || "*/*";
    },
    getUserAgent: () => {
      const v = req.headers["user-agent"];
      return Array.isArray(v) ? v[0] || "" : v || "";
    },
    getQueryParams: () => {
      const out: Record<string, string> = {};
      for (const [k, v] of url.searchParams.entries()) out[k] = v;
      return out;
    },
    getQueryParam: (name: string) => url.searchParams.get(name) || undefined,
  };
}

function paymentKeyFromPayload(payload: {
  payload?: Record<string, unknown>;
  accepted?: { amount?: string; payTo?: string };
}): string | undefined {
  const body = payload.payload || {};
  // EIP-3009 ExactEvm
  const auth = body.authorization as { nonce?: string; from?: string } | undefined;
  if (auth?.nonce) return `eip3009:${auth.nonce.toLowerCase()}`;
  // Permit2
  const p2 = body.permit2Authorization as { nonce?: string | number } | undefined;
  if (p2?.nonce !== undefined && p2.nonce !== null) return `permit2:${String(p2.nonce)}`;
  return undefined;
}

function payerFromPayload(payload: {
  payload?: Record<string, unknown>;
  payer?: string;
}): string | undefined {
  if (typeof payload.payer === "string" && payload.payer) return payload.payer;
  const body = payload.payload || {};
  const auth = body.authorization as { from?: string } | undefined;
  if (auth?.from) return auth.from;
  const p2 = body.permit2Authorization as { from?: string } | undefined;
  if (p2?.from) return p2.from;
  return undefined;
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...(headers || {}),
  });
  res.end(payload);
}

function writeHttpInstructions(
  res: ServerResponse,
  instr: { status: number; headers: Record<string, string>; body?: unknown },
): void {
  const headers = { ...instr.headers };
  if (instr.body !== undefined && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  const body =
    instr.body === undefined
      ? undefined
      : typeof instr.body === "string"
        ? instr.body
        : JSON.stringify(instr.body);
  res.writeHead(instr.status, headers);
  res.end(body);
}

export async function createSubscribeRuntime(markupPct: number): Promise<SubscribeRuntime> {
  const fac = new HTTPFacilitatorClient({ url: facilitatorUrl() });
  const resourceServer = new x402ResourceServer(fac).register("eip155:*", new ExactEvmScheme());

  const routes = {
    "GET /mcp/subscribe": {
      accepts: {
        scheme: "exact",
        network: NETWORK_BASE,
        payTo: PAY_TO_BASE,
        price: ((ctx: HTTPRequestContext) => {
          const packId = parsePackId(queryOne(ctx.adapter, "pack"));
          if (!packId) return "$5"; // unused — aborted by unpaid/abort hook
          return packPriceMoney(PACKS[packId]);
        }) as (ctx: HTTPRequestContext) => string,
      },
      description: "Vedetta MCP prepaid credit pack (starter $5 / pro $25 / desk $100)",
      mimeType: "application/json",
      unpaidResponseBody: async (ctx: HTTPRequestContext) => {
        const packId = parsePackId(queryOne(ctx.adapter, "pack"));
        if (!packId) {
          return {
            contentType: "application/json",
            body: {
              error: "Missing or invalid pack. Use pack=starter|pro|desk",
              packs: listPacks().map(p => ({
                id: p.id,
                price_usd: p.priceUsd,
                credits_usd: p.creditsUsd,
                label: p.label,
              })),
            },
          };
        }
        const pack = PACKS[packId];
        return {
          contentType: "application/json",
          body: {
            error: "Payment required",
            pack: pack.id,
            price_usd: pack.priceUsd,
            credits_usd: pack.creditsUsd,
            payTo: PAY_TO_BASE,
            network: NETWORK_BASE,
            markup_pct: markupPct,
            mcp_url: `${publicBaseUrl()}/mcp`,
          },
        };
      },
    },
    "GET /mcp/topup": {
      accepts: {
        scheme: "exact",
        network: NETWORK_BASE,
        payTo: PAY_TO_BASE,
        price: ((ctx: HTTPRequestContext) => {
          const amount = parseTopupUsd(queryOne(ctx.adapter, "amount_usd"));
          if (amount === undefined || amount < MIN_TOPUP_USD) return `$${MIN_TOPUP_USD}`;
          return `$${amount}`;
        }) as (ctx: HTTPRequestContext) => string,
      },
      description: "Vedetta MCP prepaid top-up (≥ $5 USDC → 1:1 credits)",
      mimeType: "application/json",
      unpaidResponseBody: async (ctx: HTTPRequestContext) => {
        const amount = parseTopupUsd(queryOne(ctx.adapter, "amount_usd"));
        return {
          contentType: "application/json",
          body: {
            error:
              amount === undefined || amount < MIN_TOPUP_USD
                ? `amount_usd must be ≥ ${MIN_TOPUP_USD}`
                : "Payment required",
            min_topup_usd: MIN_TOPUP_USD,
            amount_usd: amount,
            credits_usd: amount !== undefined && amount >= MIN_TOPUP_USD ? amount : undefined,
            payTo: PAY_TO_BASE,
            network: NETWORK_BASE,
            note: "Authorization: Bearer <vd_token> required to top up.",
          },
        };
      },
    },
  };

  const httpServer = new x402HTTPResourceServer(resourceServer, routes);

  // Reject bad pack / topup params before building a misleading 402.
  httpServer.onProtectedRequest(async (ctx, _route) => {
    const path = ctx.path;
    if (path === "/mcp/subscribe" || path.endsWith("/mcp/subscribe")) {
      const packId = parsePackId(queryOne(ctx.adapter, "pack"));
      if (!packId) {
        return { abort: true, reason: "Missing or invalid pack. Use pack=starter|pro|desk" };
      }
      return;
    }
    if (path === "/mcp/topup" || path.endsWith("/mcp/topup")) {
      const amount = parseTopupUsd(queryOne(ctx.adapter, "amount_usd"));
      if (amount === undefined || amount < MIN_TOPUP_USD) {
        return { abort: true, reason: `amount_usd must be ≥ ${MIN_TOPUP_USD}` };
      }
      return;
    }
  });

  await httpServer.initialize();
  return { httpServer, markupPct, publicBaseUrl: publicBaseUrl() };
}

export async function handleSubscriptionStatus(
  req: IncomingMessage,
  res: ServerResponse,
  ledger: Ledger,
  markupPct: number,
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method !== "GET" || (url.pathname !== "/mcp/subscription" && url.pathname !== "/subscription")) {
    return false;
  }
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const rec = token ? ledger.get(token) : undefined;
  if (!rec) {
    writeJson(res, 401, { error: "Unauthorized: Bearer vd_… token required" });
    return true;
  }
  writeJson(res, 200, {
    token_prefix: `${token.slice(0, 12)}…`,
    balance_usd: rec.balance,
    pack: rec.pack ?? null,
    payer: rec.payer ?? null,
    expires_at: rec.expires_at ?? null,
    markup_pct: markupPct,
    mcp_url: `${publicBaseUrl()}/mcp`,
    created_at: rec.created_at,
    last_used_at: rec.last_used_at ?? null,
  });
  return true;
}

export async function handlePaidSubscribeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ledger: Ledger,
  runtime: SubscribeRuntime,
): Promise<boolean> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname;
  const isSubscribe = path === "/mcp/subscribe" || path === "/subscribe";
  const isTopup = path === "/mcp/topup" || path === "/topup";
  if (req.method !== "GET" || (!isSubscribe && !isTopup)) return false;

  // Top-up requires an existing Bearer token up front (even for 402 catalog).
  let topupToken: string | undefined;
  if (isTopup) {
    const authHeader = req.headers.authorization || "";
    topupToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!topupToken || !ledger.get(topupToken)) {
      writeJson(res, 401, {
        error: "Unauthorized: Bearer vd_… token required for top-up",
        hint: "Subscribe first via GET /mcp/subscribe?pack=starter|pro|desk",
      });
      return true;
    }
  }

  // Idempotent replay before facilitator verify/settle (same payment hash → single credit).
  const paymentHeader = req.headers["payment-signature"] || req.headers["x-payment"];
  const paymentHeaderStr = Array.isArray(paymentHeader) ? paymentHeader[0] : paymentHeader;
  if (paymentHeaderStr) {
    try {
      const decoded = decodePaymentSignatureHeader(paymentHeaderStr);
      const earlyKey = paymentKeyFromPayload(decoded);
      if (earlyKey) {
        const prior = ledger.findSettlement(earlyKey);
        if (prior) {
          if (isSubscribe) {
            const packId = parsePackId(url.searchParams.get("pack")) || (prior.pack as PackId | undefined);
            const pack = packId ? PACKS[packId] : undefined;
            writeJson(res, 200, {
              ok: true,
              replay: true,
              token: prior.token,
              credits_usd: prior.credits_usd,
              pack: prior.pack ?? pack?.id ?? null,
              price_usd: pack?.priceUsd ?? null,
              payer: prior.payer ?? null,
              markup_pct: runtime.markupPct,
              mcp_url: `${runtime.publicBaseUrl}/mcp`,
              expires_at: null,
              tx: prior.tx ?? null,
            });
            return true;
          }
          writeJson(res, 200, {
            ok: true,
            replay: true,
            token_prefix: `${prior.token.slice(0, 12)}…`,
            credited_usd: prior.credits_usd,
            balance_usd: ledger.balance(prior.token),
            payer: prior.payer ?? null,
            tx: prior.tx ?? null,
            mcp_url: `${runtime.publicBaseUrl}/mcp`,
          });
          return true;
        }
      }
    } catch {
      /* fall through to normal verify */
    }
  }

  // Normalize path for x402 route table (always /mcp/…)
  const routePath = isSubscribe ? "/mcp/subscribe" : "/mcp/topup";
  const adapter = buildAdapter(req, url);
  // Override path so route matcher hits /mcp/subscribe even if nginx stripped prefix
  const context: HTTPRequestContext = {
    adapter: {
      ...adapter,
      getPath: () => routePath,
    },
    path: routePath,
    method: "GET",
    paymentHeader: adapter.getHeader("PAYMENT-SIGNATURE") || adapter.getHeader("X-PAYMENT"),
  };

  let result;
  try {
    result = await runtime.httpServer.processHTTPRequest(context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeJson(res, 503, { error: `x402 facilitator unavailable: ${msg}` });
    return true;
  }

  if (result.type === "payment-error") {
    // Map abort (403) to 400 for bad pack/amount with packs catalog
    if (result.response.status === 403 && isSubscribe) {
      writeJson(res, 400, {
        error: (result.response.body as { error?: string })?.error || "Invalid pack",
        packs: listPacks().map(p => ({
          id: p.id,
          price_usd: p.priceUsd,
          credits_usd: p.creditsUsd,
          label: p.label,
        })),
      });
      return true;
    }
    writeHttpInstructions(res, result.response);
    return true;
  }

  if (result.type === "no-payment-required") {
    writeJson(res, 500, { error: "Internal: subscribe route unexpectedly unpaid" });
    return true;
  }

  // payment-verified → settle → credit ledger (idempotent on payment key / tx)
  const settle = await runtime.httpServer.processSettlement(
    result.paymentPayload,
    result.paymentRequirements,
    result.declaredExtensions,
  );

  if (!settle.success) {
    writeHttpInstructions(res, {
      status: settle.response.status,
      headers: settle.headers,
      body: settle.response.body ?? {
        error: settle.errorReason || "Settlement failed",
        errorMessage: settle.errorMessage,
      },
    });
    return true;
  }

  const paymentKey =
    paymentKeyFromPayload(result.paymentPayload) ||
    (settle.transaction ? `tx:${settle.transaction.toLowerCase()}` : undefined);
  if (!paymentKey) {
    writeJson(res, 500, { error: "Settled but could not derive payment idempotency key" }, settle.headers);
    return true;
  }

  const payer =
    settle.payer ||
    payerFromPayload(result.paymentPayload as { payload?: Record<string, unknown>; payer?: string });

  try {
    if (isSubscribe) {
      const packId = parsePackId(url.searchParams.get("pack")) as PackId;
      const pack = PACKS[packId];
      const { settlement, replay, token } = ledger.creditFromPayment({
        paymentKey,
        kind: "subscribe",
        creditsUsd: pack.creditsUsd,
        payer,
        pack: pack.id,
        tx: settle.transaction,
        name: `pack:${pack.id}`,
      });
      writeJson(
        res,
        200,
        {
          ok: true,
          replay,
          token,
          credits_usd: settlement.credits_usd,
          pack: pack.id,
          price_usd: pack.priceUsd,
          payer: settlement.payer ?? payer ?? null,
          markup_pct: runtime.markupPct,
          mcp_url: `${runtime.publicBaseUrl}/mcp`,
          expires_at: null,
          tx: settlement.tx ?? settle.transaction,
        },
        settle.headers,
      );
      return true;
    }

    // topup
    const amount = parseTopupUsd(url.searchParams.get("amount_usd"))!;
    const { settlement, replay, token } = ledger.creditFromPayment({
      paymentKey,
      kind: "topup",
      creditsUsd: amount,
      payer,
      tx: settle.transaction,
      token: topupToken,
    });
    writeJson(
      res,
      200,
      {
        ok: true,
        replay,
        token_prefix: `${token.slice(0, 12)}…`,
        credited_usd: settlement.credits_usd,
        balance_usd: ledger.balance(token),
        payer: settlement.payer ?? payer ?? null,
        tx: settlement.tx ?? settle.transaction,
        mcp_url: `${runtime.publicBaseUrl}/mcp`,
      },
      settle.headers,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeJson(res, 500, { error: `Ledger credit failed after settle: ${msg}` }, settle.headers);
    return true;
  }
}
