import { memoize } from "./cache";

// Cached source fetchers. TTLs reflect how fast each datum actually moves.
// Callers see { value, stale } — stale=true means the upstream failed on this
// cycle and we're serving the last good value.

const UA = "Mozilla/5.0 (compatible; crypto-portfolio/1.0)";
const fetchOpts = { cache: "no-store" as const, headers: { "User-Agent": UA, Accept: "application/json" } };

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

export const fetchStablePriceUsd = () => memoize("stable-price", 30_000, rawStable);
export const fetchUsdKrw = () => memoize("usd-krw", 5 * 60_000, rawFx);
