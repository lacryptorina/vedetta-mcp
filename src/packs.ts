/**
 * packs.ts — MCP x402 prepaid credit packs (chat 432722d3 / subscription-model-plan).
 *
 * Prices locked by plan — do not invent alternate SKUs here.
 * starter $5→$5 · pro $25→$26 (+4%) · desk $100→$110 (+10%)
 * Top-up ≥ $5 USDC → 1:1 credits on the same Bearer token.
 */
export const PAY_TO_BASE =
  (process.env.VEDETTA_PAY_TO?.trim() as `0x${string}` | undefined) ||
  ("0x21E16F1bc3aA847236354C8193D0cB21cF412eFA" as const);

export const NETWORK_BASE = "eip155:8453" as const;

export const MIN_TOPUP_USD = 5;

export type PackId = "starter" | "pro" | "desk";

export interface PackSpec {
  id: PackId;
  priceUsd: number;
  creditsUsd: number;
  label: string;
}

export const PACKS: Record<PackId, PackSpec> = {
  starter: { id: "starter", priceUsd: 5, creditsUsd: 5, label: "Starter" },
  pro: { id: "pro", priceUsd: 25, creditsUsd: 26, label: "Pro (+4%)" },
  desk: { id: "desk", priceUsd: 100, creditsUsd: 110, label: "Desk (+10%)" },
};

export function parsePackId(raw: string | undefined | null): PackId | undefined {
  if (!raw) return undefined;
  const id = raw.trim().toLowerCase();
  if (id === "starter" || id === "pro" || id === "desk") return id;
  return undefined;
}

export function packPriceMoney(pack: PackSpec): string {
  return `$${pack.priceUsd}`;
}

export function listPacks(): PackSpec[] {
  return Object.values(PACKS);
}

export function parseTopupUsd(raw: string | undefined | null): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  // Round to USDC 6dp
  return Math.round(n * 1e6) / 1e6;
}
