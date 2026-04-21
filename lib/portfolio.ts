import { getOrCreateConfig } from "./supabase";
import { fetchMegaPriceUsd, fetchStablePriceUsd, fetchUsdKrw } from "./prices";
import { zerionPortfolio, type ZerionResult } from "./zerion";
import { sleep } from "./cache";
import type { PortfolioData, PlatformBreakdown } from "./types";

type CachedNumber = { value: number; stale: boolean; ageMs: number };
type CachedZerion = { value: ZerionResult; stale: boolean; ageMs: number };

function describeAge(ageMs: number): string {
  const s = Math.round(ageMs / 1000);
  if (s < 60) return `${s}s old`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m old`;
  return `${Math.round(m / 60)}h old`;
}

async function safePrice(
  label: string,
  fn: () => Promise<CachedNumber>,
  warnings: string[],
): Promise<number> {
  try {
    const r = await fn();
    if (r.stale) warnings.push(`${label}: using cached value (${describeAge(r.ageMs)})`);
    return r.value;
  } catch (e: any) {
    warnings.push(`${label}: ${String(e?.message ?? e)}`);
    return 0;
  }
}

async function safeZerion(
  label: string,
  address: string | null,
  apiKey: string,
  warnings: string[],
): Promise<{ result: ZerionResult; unavailable: boolean }> {
  if (!address) {
    return { result: { totalUsd: 0, positions: [] }, unavailable: true };
  }
  try {
    const r = (await zerionPortfolio(address, apiKey)) as CachedZerion;
    if (r.stale) warnings.push(`${label}: using cached portfolio (${describeAge(r.ageMs)})`);
    return { result: r.value, unavailable: false };
  } catch (e: any) {
    warnings.push(`${label}: ${String(e?.message ?? e)}`);
    // No cached value AND fresh fetch failed — treat as unavailable so we
    // don't silently zero out this platform in the breakdown.
    return { result: { totalUsd: 0, positions: [] }, unavailable: true };
  }
}

export async function computePortfolio(): Promise<PortfolioData & { warnings: string[] }> {
  const cfg = await getOrCreateConfig();
  const zerionKey = process.env.ZERION_API_KEY ?? "";
  const warnings: string[] = [];

  // Prices and FX can run in parallel (different hosts, no shared quota).
  const [megaPrice, stablePrice, usdKrw] = await Promise.all([
    safePrice("MEGA price", fetchMegaPriceUsd, warnings),
    safePrice("STABLE price", fetchStablePriceUsd, warnings),
    safePrice("USD/KRW", fetchUsdKrw, warnings),
  ]);

  // Zerion rate-limits aggressively on the free tier — serialize the two
  // address calls with a small gap so back-to-back refreshes are less likely
  // to get the second request throttled.
  const rabby = await safeZerion("Rabby", cfg.evm_address, zerionKey, warnings);
  if (cfg.evm_address && cfg.solana_address) await sleep(400);
  const phantom = await safeZerion("Phantom", cfg.solana_address, zerionKey, warnings);

  // Remove any MEGA position from Rabby total so we don't double-count — we
  // add a fresh MEGA valuation from Bybit's live price below.
  const megaInRabby = rabby.result.positions
    .filter((p) => p.symbol === "MEGA")
    .reduce((a, b) => a + b.valueUsd, 0);
  const rabbyNetUsd = Math.max(0, rabby.result.totalUsd - megaInRabby);

  const megaValueUsd = Number(cfg.mega_qty) * megaPrice;
  const stableValueUsd = Number(cfg.stable_qty) * stablePrice;

  type Part = { label: string; valueUsd: number; unavailable: boolean };
  const parts: Part[] = [
    { label: "Rabby (Net)", valueUsd: rabbyNetUsd, unavailable: rabby.unavailable },
    { label: "$MEGA · MegaETH", valueUsd: megaValueUsd, unavailable: false },
    { label: "Phantom", valueUsd: phantom.result.totalUsd, unavailable: phantom.unavailable },
    { label: "Bybit · $STABLE", valueUsd: stableValueUsd, unavailable: false },
  ];

  // Available parts drive totals. Unavailable parts still appear in the
  // breakdown with share=-1 (rendered as "—") so the user notices a miss.
  const availableTotalUsd = parts
    .filter((p) => !p.unavailable)
    .reduce((a, b) => a + b.valueUsd, 0);
  const totalKrw = availableTotalUsd * usdKrw;

  const breakdown: PlatformBreakdown[] = parts.map((p) => ({
    label: p.unavailable ? `${p.label} · unavailable` : p.label,
    valueUsd: p.unavailable ? 0 : p.valueUsd,
    valueKrw: p.unavailable ? 0 : p.valueUsd * usdKrw,
    share:
      p.unavailable || availableTotalUsd <= 0 ? 0 : p.valueUsd / availableTotalUsd,
  }));

  const deposit = Number(cfg.total_deposit_krw);
  const profitKrw = totalKrw - deposit;
  const profitPct = deposit > 0 ? (profitKrw / deposit) * 100 : 0;

  return {
    asOf: new Date().toISOString(),
    totalUsd: availableTotalUsd,
    totalKrw,
    usdKrwRate: usdKrw,
    megaPriceUsd: megaPrice,
    stablePriceUsd: stablePrice,
    breakdown,
    totalDepositKrw: deposit,
    profitKrw,
    profitPct,
    warnings,
  };
}
