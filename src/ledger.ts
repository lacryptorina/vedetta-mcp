/**
 * ledger.ts — credit ledger for hosted (--http) mode.
 *
 * Zero-dependency JSON file store with atomic writes. Structure:
 *   { tokens: { "<token>": { name, balance, created_at, last_used_at } },
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
}

export interface TxRecord {
  ts: string;
  token: string;
  kind: "credit" | "debit";
  usd: number;
  note: string;
}

interface LedgerFile {
  tokens: Record<string, TokenRecord>;
  tx: TxRecord[];
}

const DEFAULT_PATH = join(process.env.HOME || ".", ".vedetta-mcp", "ledger.json");

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
        this.data = JSON.parse(readFileSync(this.path, "utf8"));
        this.lastMtimeMs = statSync(this.path).mtimeMs;
      } catch {
        this.data = { tokens: {}, tx: [] };
        this.lastMtimeMs = 0;
      }
    } else {
      this.data = { tokens: {}, tx: [] };
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
  }

  /** Generate a new token with an initial credit balance. Returns the token. */
  issue(name: string, creditsUsd: number): string {
    const token = `vd_${randomBytes(24).toString("hex")}`;
    this.data.tokens[token] = {
      name,
      balance: Math.round(creditsUsd * 1e6) / 1e6,
      created_at: new Date().toISOString(),
    };
    this.pushTx(token, "credit", creditsUsd, "issue");
    this.flush();
    return token;
  }

  addCredits(token: string, creditsUsd: number): boolean {
    const rec = this.data.tokens[token];
    if (!rec) return false;
    rec.balance = Math.round((rec.balance + creditsUsd) * 1e6) / 1e6;
    this.pushTx(token, "credit", creditsUsd, "topup");
    this.flush();
    return true;
  }

  /** Debit if sufficient balance. Returns remaining balance, or undefined if
   * the token is unknown or the balance is insufficient. */
  debit(token: string, usd: number): number | undefined {
    this.maybeReload();
    const rec = this.data.tokens[token];
    if (!rec) return undefined;
    const cost = Math.round(usd * 1e6) / 1e6;
    if (rec.balance < cost) return undefined;
    rec.balance = Math.round((rec.balance - cost) * 1e6) / 1e6;
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
      usd: Math.round(usd * 1e6) / 1e6,
      note,
    });
    // keep tx log bounded
    if (this.data.tx.length > 5000) this.data.tx = this.data.tx.slice(-1000);
  }
}
