import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_TOPUP_USD,
  PACKS,
  PAY_TO_BASE,
  listPacks,
  parsePackId,
  parseTopupUsd,
  packPriceMoney,
} from "./packs.js";

describe("prepaid packs catalog", () => {
  it("locks plan prices $5 / $25 / $100 with stated credit bonuses", () => {
    assert.equal(PACKS.starter.priceUsd, 5);
    assert.equal(PACKS.starter.creditsUsd, 5);
    assert.equal(PACKS.pro.priceUsd, 25);
    assert.equal(PACKS.pro.creditsUsd, 26);
    assert.equal(PACKS.desk.priceUsd, 100);
    assert.equal(PACKS.desk.creditsUsd, 110);
    assert.equal(listPacks().length, 3);
  });

  it("uses Base OG payTo (never invents ACP/FluxA)", () => {
    assert.match(PAY_TO_BASE, /^0x21E16F1bc3aA847236354C8193D0cB21cF412eFA$/i);
  });

  it("parses pack ids and rejects unknowns", () => {
    assert.equal(parsePackId("starter"), "starter");
    assert.equal(parsePackId("PRO"), "pro");
    assert.equal(parsePackId("desk"), "desk");
    assert.equal(parsePackId("monthly"), undefined);
    assert.equal(parsePackId(""), undefined);
  });

  it("formats money for ExactEvm price field", () => {
    assert.equal(packPriceMoney(PACKS.pro), "$25");
  });

  it("enforces top-up floor of $5", () => {
    assert.equal(MIN_TOPUP_USD, 5);
    assert.equal(parseTopupUsd("5"), 5);
    assert.equal(parseTopupUsd("4.99"), 4.99);
    assert.equal(parseTopupUsd("nope"), undefined);
  });
});
