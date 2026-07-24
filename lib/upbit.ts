// Upbit — quantities come from the sync worker (scripts/upbit-sync) via
// Supabase, because Upbit's authenticated API demands an IP allowlist that
// Vercel's rotating egress cannot satisfy. Pricing happens here with Upbit's
// public quotation API, which needs neither auth nor an allowlisted IP.
import { memoize } from "./cache";
import { supabaseAdmin } from "./supabase";

export type UpbitPosition = {
  currency: string;
  quantity: number;
  valueKrw: number;
};

export type UpbitResult = {
  totalKrw: number;
  positions: UpbitPosition[];
  /** Newest `updated_at` across balance rows; null when nothing synced yet. */
  syncedAt: string | null;
  /** Currencies held but not priceable on a KRW market — excluded from totals. */
  unpriced: string[];
};

type BalanceRow = {
  currency: string;
  balance: number | string;
  locked: number | string;
  updated_at: string;
};

const UA = "Mozilla/5.0 (compatible; crypto-portfolio/1.0)";
const fetchOpts = {
  cache: "no-store" as const,
  headers: { "User-Agent": UA, Accept: "application/json" },
};

async function rawKrwMarkets(): Promise<Set<string>> {
  const r = await fetch("https://api.upbit.com/v1/market/all", fetchOpts);
  if (!r.ok) throw new Error(`Upbit markets HTTP ${r.status}`);
  const j = await r.json();
  const set = new Set<string>();
  for (const m of Array.isArray(j) ? j : []) {
    const code = String(m?.market ?? "");
    if (code.startsWith("KRW-")) set.add(code);
  }
  if (set.size === 0) throw new Error("Upbit markets empty");
  return set;
}

// The listed-market set barely moves; a long TTL keeps us far from the
// 10 req/s public quota even across cold starts.
const krwMarkets = () => memoize("upbit-markets", 6 * 60 * 60_000, rawKrwMarkets);

async function rawTickers(markets: string[]): Promise<Map<string, number>> {
  const url = `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets.join(","))}`;
  const r = await fetch(url, fetchOpts);
  if (!r.ok) throw new Error(`Upbit ticker HTTP ${r.status}`);
  const j = await r.json();
  const map = new Map<string, number>();
  for (const t of Array.isArray(j) ? j : []) {
    const market = String(t?.market ?? "");
    const price = Number(t?.trade_price);
    if (market && Number.isFinite(price)) map.set(market, price);
  }
  return map;
}

// Sorting keeps the cache key stable regardless of row order from Supabase.
function tickers(markets: string[]) {
  const sorted = [...markets].sort();
  return memoize(`upbit-ticker:${sorted.join(",")}`, 30_000, () => rawTickers(sorted));
}

async function readBalances(): Promise<BalanceRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("upbit_balances")
    .select("currency,balance,locked,updated_at");
  if (error) throw new Error(`upbit_balances read failed: ${error.message}`);
  return (data ?? []) as BalanceRow[];
}

/**
 * Value the synced Upbit balances in KRW.
 *
 * `balance + locked` is the real holding — `locked` covers quantity tied up in
 * open orders, which is still the user's asset. KRW rows are cash and count at
 * face value.
 */
export async function upbitPortfolio(): Promise<UpbitResult> {
  const rows = await readBalances();
  if (rows.length === 0) {
    return { totalKrw: 0, positions: [], syncedAt: null, unpriced: [] };
  }

  const syncedAt = rows.reduce(
    (max, r) => (r.updated_at > max ? r.updated_at : max),
    rows[0].updated_at,
  );

  let totalKrw = 0;
  const positions: UpbitPosition[] = [];
  const unpriced: string[] = [];
  const coins: { currency: string; quantity: number }[] = [];

  for (const r of rows) {
    const quantity = Number(r.balance) + Number(r.locked);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (r.currency === "KRW") {
      totalKrw += quantity;
      positions.push({ currency: "KRW", quantity, valueKrw: quantity });
      continue;
    }
    coins.push({ currency: r.currency, quantity });
  }

  if (coins.length > 0) {
    // Ticker rejects the whole request if any market code is unknown, so filter
    // against the listed KRW markets first rather than risking a 400 that would
    // zero out every coin.
    const markets = await krwMarkets();
    const priceable = coins.filter((c) => markets.value.has(`KRW-${c.currency}`));
    for (const c of coins) {
      if (!markets.value.has(`KRW-${c.currency}`)) unpriced.push(c.currency);
    }

    if (priceable.length > 0) {
      const prices = await tickers(priceable.map((c) => `KRW-${c.currency}`));
      for (const c of priceable) {
        const price = prices.value.get(`KRW-${c.currency}`);
        if (price == null) {
          unpriced.push(c.currency);
          continue;
        }
        const valueKrw = c.quantity * price;
        totalKrw += valueKrw;
        positions.push({ currency: c.currency, quantity: c.quantity, valueKrw });
      }
    }
  }

  positions.sort((a, b) => b.valueKrw - a.valueKrw);
  return { totalKrw, positions, syncedAt, unpriced };
}
