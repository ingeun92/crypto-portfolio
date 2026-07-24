import { getOrCreateConfig } from "./supabase";
import { fetchStablePriceUsd, fetchUsdKrw } from "./prices";
import { zerionPortfolio, type ZerionResult } from "./zerion";
import { suiPortfolio, type SuiResult } from "./sui";
import { upbitPortfolio, type UpbitResult } from "./upbit";
import { sleep } from "./cache";
import type { PortfolioData, PlatformBreakdown } from "./types";

type CachedNumber = { value: number; stale: boolean; ageMs: number };
type CachedZerion = { value: ZerionResult; stale: boolean; ageMs: number };
type CachedSui = { value: SuiResult; stale: boolean; ageMs: number };

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
  chainId?: string,
): Promise<{ result: ZerionResult; unavailable: boolean }> {
  if (!address) {
    return { result: { totalUsd: 0, positions: [] }, unavailable: true };
  }
  try {
    const r = (await zerionPortfolio(address, apiKey, chainId)) as CachedZerion;
    if (r.stale) warnings.push(`${label}: using cached portfolio (${describeAge(r.ageMs)})`);
    return { result: r.value, unavailable: false };
  } catch (e: any) {
    warnings.push(`${label}: ${String(e?.message ?? e)}`);
    // No cached value AND fresh fetch failed — treat as unavailable so we
    // don't silently zero out this platform in the breakdown.
    return { result: { totalUsd: 0, positions: [] }, unavailable: true };
  }
}

async function safeSui(
  label: string,
  address: string | null,
  warnings: string[],
): Promise<{ result: SuiResult; unavailable: boolean }> {
  if (!address) {
    return { result: { totalUsd: 0, positions: [] }, unavailable: true };
  }
  try {
    const r = (await suiPortfolio(address)) as CachedSui;
    if (r.stale) warnings.push(`${label}: using cached portfolio (${describeAge(r.ageMs)})`);
    return { result: r.value, unavailable: false };
  } catch (e: any) {
    warnings.push(`${label}: ${String(e?.message ?? e)}`);
    return { result: { totalUsd: 0, positions: [] }, unavailable: true };
  }
}

// The sync worker runs once a day, shortly before the nightly snapshot, so
// balances are routinely up to 24h old. Warn only past that — a missed run
// means the VM or cron is wedged and the quantities may no longer be real.
const UPBIT_STALE_MS = 30 * 60 * 60_000;

async function safeUpbit(
  label: string,
  warnings: string[],
): Promise<{ result: UpbitResult; unavailable: boolean }> {
  try {
    const result = await upbitPortfolio();
    if (!result.syncedAt) {
      warnings.push(`${label}: no synced balances yet — run the sync worker`);
      return { result, unavailable: true };
    }
    const ageMs = Date.now() - Date.parse(result.syncedAt);
    if (Number.isFinite(ageMs) && ageMs > UPBIT_STALE_MS) {
      warnings.push(`${label}: balances last synced ${describeAge(ageMs)}`);
    }
    if (result.unpriced.length > 0) {
      warnings.push(`${label}: no KRW market for ${result.unpriced.join(", ")} — excluded`);
    }
    return { result, unavailable: false };
  } catch (e: any) {
    warnings.push(`${label}: ${String(e?.message ?? e)}`);
    return {
      result: { totalKrw: 0, positions: [], syncedAt: null, unpriced: [] },
      unavailable: true,
    };
  }
}

export async function computePortfolio(): Promise<PortfolioData & { warnings: string[] }> {
  const cfg = await getOrCreateConfig();
  const zerionKey = process.env.ZERION_API_KEY ?? "";
  const warnings: string[] = [];

  // Prices and FX can run in parallel (different hosts, no shared quota).
  const [stablePrice, usdKrw] = await Promise.all([
    safePrice("STABLE price", fetchStablePriceUsd, warnings),
    safePrice("USD/KRW", fetchUsdKrw, warnings),
  ]);

  // Zerion rate-limits aggressively on the free tier — serialize the two
  // address calls with a gap so back-to-back refreshes are less likely to get
  // the second request throttled. ~900ms empirically avoids the burst cap for
  // Phantom (Solana) that we'd previously see 429s on. Sui uses a separate
  // RPC + CoinGecko, so we fire it in parallel with the second Zerion call.
  const rabby = await safeZerion("Rabby", cfg.evm_address, zerionKey, warnings);
  if (cfg.evm_address && cfg.solana_address) await sleep(900);
  const [phantomSol, phantomSui, upbit] = await Promise.all([
    safeZerion("Phantom (Solana)", cfg.solana_address, zerionKey, warnings, "solana"),
    safeSui("Phantom (Sui)", cfg.sui_address, warnings),
    safeUpbit("Upbit", warnings),
  ]);

  const rabbyNetUsd = rabby.result.totalUsd;

  const stableValueUsd = Number(cfg.stable_qty) * stablePrice;

  // Phantom holds both Solana (via Zerion) and Sui (via Sui RPC + CoinGecko).
  // Treat Phantom as unavailable only when every configured address failed,
  // so a partial result (e.g. Sui priced but Solana rate-limited) still shows.
  const phantomHasSol = !!cfg.solana_address && !phantomSol.unavailable;
  const phantomHasSui = !!cfg.sui_address && !phantomSui.unavailable;
  const phantomConfigured = !!cfg.solana_address || !!cfg.sui_address;
  const phantomValueUsd =
    (phantomHasSol ? phantomSol.result.totalUsd : 0) + (phantomHasSui ? phantomSui.result.totalUsd : 0);
  const phantomUnavailable = !phantomConfigured || (!phantomHasSol && !phantomHasSui);

  // Upbit is KRW-native while the rest of the pipeline is USD-first, so convert
  // here. Without a live FX rate the conversion is meaningless — mark the
  // platform unavailable rather than folding a bogus number into the total.
  const upbitFxMissing = !upbit.unavailable && usdKrw <= 0;
  if (upbitFxMissing) warnings.push("Upbit: no USD/KRW rate — value omitted");
  const upbitValueUsd = usdKrw > 0 ? upbit.result.totalKrw / usdKrw : 0;

  type Part = { label: string; valueUsd: number; unavailable: boolean };
  const parts: Part[] = [
    { label: "Rabby", valueUsd: rabbyNetUsd, unavailable: rabby.unavailable },
    { label: "Phantom", valueUsd: phantomValueUsd, unavailable: phantomUnavailable },
    { label: "Upbit", valueUsd: upbitValueUsd, unavailable: upbit.unavailable || upbitFxMissing },
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
    stablePriceUsd: stablePrice,
    breakdown,
    totalDepositKrw: deposit,
    profitKrw,
    profitPct,
    warnings,
  };
}
