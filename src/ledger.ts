/**
 * ledger.ts — credit ledger for hosted (--http) mode.
 *
 * Zero-dependency JSON file store with atomic writes. Structure:
 *   { tokens: { "<token>": { name, balance, created_at, last_used_at?,
 *                            payer?, pack?, expires_at? } },
 *     settlements: { "<paymentKey>": { token, credits_usd, kind, ts, tx? } },
 *     tx: [{ ts, token, kind: "credit"|"debit", usd, note }] }
 *
 * Concurrency: single process, in-memory copy + write-through on each mutation.
 * Writes go to a temp file then rename (atomic on same filesystem).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

export interface TokenRecord {
  name: string;
  balance: number; // USD credits, 6-decimal precision
  created_at: string;
  last_used_at?: string;
  /** Paying address from x402 settlement (when known). */
  payer?: string;
  /** Pack id for the initial subscribe mint (starter|pro|desk). */
  pack?: string;
  /** ISO expiry; null/omit = prepaid forever (MVP packs). */
  expires_at?: string | null;
}

export interface TxRecord {
  ts: string;
  token: string;
  kind: "credit" | "debit";
  usd: number;
  note: string;
}

export interface SettlementRecord {
  token: string;
  credits_usd: number;
  kind: "subscribe" | "topup";
  ts: string;
  tx?: string;
  payer?: string;
  pack?: string;
}

interface LedgerFile {
  tokens: Record<string, TokenRecord>;
  tx: TxRecord[];
  settlements: Record<string, SettlementRecord>;
}

const DEFAULT_PATH = join(process.env.HOME || ".", ".vedetta-mcp", "ledger.json");

function emptyLedger(): LedgerFile {
  return { tokens: {}, tx: [], settlements: {} };
}

function roundUsd(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

export class Ledger {
  private data!: LedgerFile;
  private path: string;
  private lastMtimeMs = 0;

  constructor(path = process.env.VEDETTA_LEDGER_PATH || DEFAULT_PATH) {
    this.path = path;
    this.load();
  }

  /** Re-read the file when another process (CLI) changed it. */
  private load(): void {
    if (existsSync(this.path)) {
      try {
        const raw = JSON.parse(readFileSync(this.path, "utf8")) as Partial<LedgerFile>;
        this.data = {
          tokens: raw.tokens || {},
          tx: Array.isArray(raw.tx) ? raw.tx : [],
          settlements: raw.settlements || {},
        };
        this.lastMtimeMs = statSync(this.path).mtimeMs;
      } catch {
        this.data = emptyLedger();
        this.lastMtimeMs = 0;
      }
    } else {
      this.data = emptyLedger();
      this.lastMtimeMs = 0;
      this.flush();
    }
  }

  private maybeReload(): void {
    try {
      const m = statSync(this.path).mtimeMs;
      if (m !== this.lastMtimeMs) this.load();
    } catch {
      /* file vanished — keep current copy */
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
    try {
      this.lastMtimeMs = statSync(this.path).mtimeMs;
    } catch {
      /* ignore */
    }
  }

  /** Generate a new token with an initial credit balance. Returns the token. */
  issue(
    name: string,
    creditsUsd: number,
    extra?: { payer?: string; pack?: string; expires_at?: string | null },
  ): string {
    this.maybeReload();
    const token = `vd_${randomBytes(24).toString("hex")}`;
    this.data.tokens[token] = {
      name,
      balance: roundUsd(creditsUsd),
      created_at: new Date().toISOString(),
      ...(extra?.payer ? { payer: extra.payer } : {}),
      ...(extra?.pack ? { pack: extra.pack } : {}),
      expires_at: extra?.expires_at === undefined ? null : extra.expires_at,
    };
    this.pushTx(token, "credit", creditsUsd, extra?.pack ? `issue:${extra.pack}` : "issue");
    this.flush();
    return token;
  }

  addCredits(token: string, creditsUsd: number, note = "topup"): boolean {
    this.maybeReload();
    const rec = this.data.tokens[token];
    if (!rec) return false;
    rec.balance = roundUsd(rec.balance + creditsUsd);
    this.pushTx(token, "credit", creditsUsd, note);
    this.flush();
    return true;
  }

  /**
   * Credit once per payment key (authorization nonce or settlement tx).
   * Replays return the prior settlement without double-crediting.
   * Token mint/top-up + settlement row flush atomically.
   */
  creditFromPayment(opts: {
    paymentKey: string;
    kind: "subscribe" | "topup";
    creditsUsd: number;
    payer?: string;
    pack?: string;
    tx?: string;
    /** Required for topup; ignored for subscribe (a new token is minted). */
    token?: string;
    name?: string;
  }): { settlement: SettlementRecord; replay: boolean; token: string } {
    this.maybeReload();
    const existing = this.data.settlements[opts.paymentKey];
    if (existing) {
      return { settlement: existing, replay: true, token: existing.token };
    }

    const credits = roundUsd(opts.creditsUsd);
    let token: string;
    if (opts.kind === "subscribe") {
      token = `vd_${randomBytes(24).toString("hex")}`;
      this.data.tokens[token] = {
        name: opts.name || `pack:${opts.pack || "unknown"}`,
        balance: credits,
        created_at: new Date().toISOString(),
        ...(opts.payer ? { payer: opts.payer } : {}),
        ...(opts.pack ? { pack: opts.pack } : {}),
        expires_at: null,
      };
      this.pushTx(token, "credit", credits, opts.pack ? `issue:${opts.pack}` : "issue");
    } else {
      if (!opts.token || !this.data.tokens[opts.token]) {
        throw new Error("Unknown token for topup");
      }
      token = opts.token;
      const rec = this.data.tokens[token];
      rec.balance = roundUsd(rec.balance + credits);
      if (opts.payer && !rec.payer) rec.payer = opts.payer;
      this.pushTx(token, "credit", credits, "topup:x402");
    }

    const settlement: SettlementRecord = {
      token,
      credits_usd: credits,
      kind: opts.kind,
      ts: new Date().toISOString(),
      ...(opts.tx ? { tx: opts.tx } : {}),
      ...(opts.payer ? { payer: opts.payer } : {}),
      ...(opts.pack ? { pack: opts.pack } : {}),
    };
    this.data.settlements[opts.paymentKey] = settlement;
    this.flush();
    return { settlement, replay: false, token };
  }

  findSettlement(paymentKey: string): SettlementRecord | undefined {
    this.maybeReload();
    return this.data.settlements[paymentKey];
  }

  /** Debit if sufficient balance. Returns remaining balance, or undefined if
   * the token is unknown or the balance is insufficient. */
  debit(token: string, usd: number): number | undefined {
    this.maybeReload();
    const rec = this.data.tokens[token];
    if (!rec) return undefined;
    const cost = roundUsd(usd);
    if (rec.balance < cost) return undefined;
    rec.balance = roundUsd(rec.balance - cost);
    rec.last_used_at = new Date().toISOString();
    this.pushTx(token, "debit", cost, "call");
    this.flush();
    return rec.balance;
  }

  /** Non-mutating balance check. Returns balance or undefined if unknown. */
  balance(token: string): number | undefined {
    this.maybeReload();
    return this.data.tokens[token]?.balance;
  }

  get(token: string): TokenRecord | undefined {
    this.maybeReload();
    return this.data.tokens[token];
  }

  list(): Array<{ token: string } & TokenRecord> {
    this.maybeReload();
    return Object.entries(this.data.tokens).map(([token, rec]) => ({ token, ...rec }));
  }

  private pushTx(token: string, kind: "credit" | "debit", usd: number, note: string): void {
    this.data.tx.push({
      ts: new Date().toISOString(),
      token,
      kind,
      usd: roundUsd(usd),
      note,
    });
    // keep tx log bounded
    if (this.data.tx.length > 5000) this.data.tx = this.data.tx.slice(-1000);
  }
}
