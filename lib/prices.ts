import { memoize } from "./cache";

// Cached source fetchers. TTLs reflect how fast each datum actually moves.
// Callers see { value, stale } — stale=true means the upstream failed on this
// cycle and we're serving the last good value.

const UA = "Mozilla/5.0 (compatible; crypto-portfolio/1.0)";
const fetchOpts = { cache: "no-store" as const, headers: { "User-Agent": UA, Accept: "application/json" } };

async function rawMega(): Promise<number> {
  const url = "https://api.bybit.com/v5/market/tickers?category=linear&symbol=MEGAUSDT";
  const r = await fetch(url, fetchOpts);
  if (!r.ok) throw new Error(`Bybit MEGA HTTP ${r.status}`);
  const j = await r.json();
  if (j?.retCode !== 0) throw new Error(`Bybit MEGA retCode ${j?.retCode}: ${j?.retMsg}`);
  const last = j?.result?.list?.[0]?.lastPrice;
  if (!last) throw new Error("Bybit MEGA empty result");
  return Number(last);
}

async function rawStable(): Promise<number> {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=stable-2&vs_currencies=usd";
  const r = await fetch(url, fetchOpts);
  if (!r.ok) throw new Error(`CoinGecko STABLE HTTP ${r.status}`);
  const j = await r.json();
  const p = j?.["stable-2"]?.usd;
  if (p == null) throw new Error("CoinGecko STABLE missing");
  return Number(p);
}

async function rawFx(): Promise<number> {
  const r = await fetch("https://open.er-api.com/v6/latest/USD", fetchOpts);
  if (!r.ok) throw new Error(`FX HTTP ${r.status}`);
  const j = await r.json();
  const krw = j?.rates?.KRW;
  if (!krw) throw new Error("FX KRW missing");
  return Number(krw);
}

export const fetchMegaPriceUsd = () => memoize("mega-price", 30_000, rawMega);
export const fetchStablePriceUsd = () => memoize("stable-price", 30_000, rawStable);
export const fetchUsdKrw = () => memoize("usd-krw", 5 * 60_000, rawFx);
