// Sui mainnet — balances via JSON-RPC, prices via CoinGecko.
//
// Two CoinGecko quirks drove this approach:
//  1) The free-tier `simple/token_price/sui` endpoint only accepts one
//     contract_address per request (error 10012), so batching fails for
//     wallets holding multiple Sui coins.
//  2) CoinGecko stores Sui platform addresses in fully 32-byte-padded form
//     (e.g. `0x0000…0002::sui::SUI` for native SUI), while Sui RPC returns
//     the short canonical form (`0x2::sui::SUI`). Direct string matching
//     misses the native coin entirely.
//
// Instead, we fetch `coins/list?include_platform=true` once (cached 6h),
// build a normalized coinType → CoinGecko id map, then batch-price all
// mapped coins with `simple/price?ids=…`.
import { memoize } from "./cache";

export type SuiPosition = {
  symbol: string;
  valueUsd: number;
  quantity: number;
};

export type SuiResult = {
  totalUsd: number;
  positions: SuiPosition[];
};

const RPC_URL = "https://fullnode.mainnet.sui.io:443";
const UA = "Mozilla/5.0 (compatible; crypto-portfolio/1.0)";

type RpcBalance = { coinType: string; totalBalance: string };
type RpcMetadata = { decimals: number; symbol: string } | null;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Sui RPC ${method} ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  if (j?.error) throw new Error(`Sui RPC ${method}: ${j.error.message ?? j.error.code}`);
  return j.result as T;
}

// Zero-pad the address prefix to 32 bytes so short-form `0x2::sui::SUI` and
// long-form `0x0000…0002::sui::SUI` collapse to the same key. Module and
// type names are left as-is (they remain case-sensitive in Sui).
function normalizeCoinType(t: string): string {
  const parts = t.split("::");
  if (parts.length < 2) return t.toLowerCase();
  const addr = parts[0].toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return `0x${addr}::${parts.slice(1).join("::")}`;
}

async function rawCoinMap(): Promise<Record<string, string>> {
  const r = await fetch("https://api.coingecko.com/api/v3/coins/list?include_platform=true", {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`CoinGecko coins/list ${r.status}`);
  const list = (await r.json()) as Array<{ id: string; platforms?: Record<string, string | null> }>;
  const out: Record<string, string> = {};
  for (const c of list) {
    const suiAddr = c.platforms?.sui;
    if (!suiAddr) continue;
    out[normalizeCoinType(suiAddr)] = c.id;
  }
  return out;
}

function fetchSuiCoinMap() {
  return memoize("sui-coin-map", 6 * 60 * 60 * 1000, rawCoinMap);
}

async function fetchPricesByIds(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    `?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) return {};
  const j = await r.json().catch(() => ({}));
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(j ?? {})) {
    const p = Number((v as any)?.usd);
    if (Number.isFinite(p)) out[id] = p;
  }
  return out;
}

async function rawSui(address: string): Promise<SuiResult> {
  const balances = (await rpc<RpcBalance[]>("suix_getAllBalances", [address])) ?? [];
  // Drop zero balances early — scam-targeted wallets can accumulate hundreds
  // of dust coin types that would otherwise flood per-coin metadata calls.
  const nonZero = balances.filter((b) => b.totalBalance && b.totalBalance !== "0");
  if (nonZero.length === 0) return { totalUsd: 0, positions: [] };

  const [metas, coinMapRes] = await Promise.all([
    Promise.all(
      nonZero.map((b) => rpc<RpcMetadata>("suix_getCoinMetadata", [b.coinType]).catch(() => null)),
    ),
    fetchSuiCoinMap(),
  ]);
  const coinMap = coinMapRes.value;

  const ids = Array.from(
    new Set(
      nonZero
        .map((b) => coinMap[normalizeCoinType(b.coinType)])
        .filter((x): x is string => !!x),
    ),
  );
  const prices = await fetchPricesByIds(ids);

  const positions: SuiPosition[] = nonZero.map((b, i) => {
    const meta = metas[i];
    const decimals = meta?.decimals ?? 9;
    const symbol = (meta?.symbol ?? "").toUpperCase() || "UNKNOWN";
    const qty = Number(b.totalBalance) / Math.pow(10, decimals);
    const id = coinMap[normalizeCoinType(b.coinType)];
    const price = id ? prices[id] ?? 0 : 0;
    const valueUsd = qty * price;
    return {
      symbol,
      quantity: Number.isFinite(qty) ? qty : 0,
      valueUsd: Number.isFinite(valueUsd) ? valueUsd : 0,
    };
  });

  const totalUsd = positions.reduce((a, b) => a + b.valueUsd, 0);
  return { totalUsd, positions };
}

/** Cached wrapper. Same 90s TTL as Zerion for consistent refresh cadence. */
export function suiPortfolio(address: string) {
  if (!address)
    return Promise.resolve({ value: { totalUsd: 0, positions: [] } as SuiResult, stale: false, ageMs: 0 });
  return memoize(`sui:${address}`, 90_000, () => rawSui(address));
}
