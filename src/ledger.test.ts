import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger } from "./ledger.js";
import { ROUTES } from "./routes.js";

describe("ledger prepaid settlements", () => {
  let dir: string;
  let path: string;
  let ledger: Ledger;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vedetta-ledger-"));
    path = join(dir, "ledger.json");
    ledger = new Ledger(path);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("issues with payer/pack/expires_at null", () => {
    const token = ledger.issue("pack:starter", 5, {
      payer: "0xabc",
      pack: "starter",
      expires_at: null,
    });
    const rec = ledger.get(token)!;
    assert.equal(rec.balance, 5);
    assert.equal(rec.pack, "starter");
    assert.equal(rec.payer, "0xabc");
    assert.equal(rec.expires_at, null);
  });

  it("credits once per payment key (subscribe replay)", () => {
    const a = ledger.creditFromPayment({
      paymentKey: "eip3009:0xn1",
      kind: "subscribe",
      creditsUsd: 26,
      pack: "pro",
      payer: "0xpayer",
      tx: "0xtx1",
    });
    assert.equal(a.replay, false);
    assert.equal(a.settlement.credits_usd, 26);
    assert.ok(a.token.startsWith("vd_"));

    const b = ledger.creditFromPayment({
      paymentKey: "eip3009:0xn1",
      kind: "subscribe",
      creditsUsd: 26,
      pack: "pro",
      payer: "0xpayer",
      tx: "0xtx1",
    });
    assert.equal(b.replay, true);
    assert.equal(b.token, a.token);
    assert.equal(ledger.balance(a.token), 26);
  });

  it("top-up is idempotent on payment key", () => {
    const token = ledger.issue("t", 5);
    const a = ledger.creditFromPayment({
      paymentKey: "eip3009:0xn2",
      kind: "topup",
      creditsUsd: 10,
      token,
      tx: "0xtx2",
    });
    assert.equal(a.replay, false);
    assert.equal(ledger.balance(token), 15);

    const b = ledger.creditFromPayment({
      paymentKey: "eip3009:0xn2",
      kind: "topup",
      creditsUsd: 10,
      token,
      tx: "0xtx2",
    });
    assert.equal(b.replay, true);
    assert.equal(ledger.balance(token), 15);
  });

  it("debits paid tools with markup; free tools cost 0", () => {
    const markupPct = 30;
    const token = ledger.issue("t", 1);
    for (const route of Object.values(ROUTES)) {
      const cost = Math.round(route.capUsd * (1 + markupPct / 100) * 1e6) / 1e6;
      if (route.capUsd <= 0) {
        assert.equal(cost, 0, `${route.path} must stay free`);
      }
    }
    const historyCost = Math.round(0.01 * 1.3 * 1e6) / 1e6;
    const remaining = ledger.debit(token, historyCost);
    assert.equal(remaining, Math.round((1 - historyCost) * 1e6) / 1e6);
  });
});
