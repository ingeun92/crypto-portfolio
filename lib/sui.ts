// Sui mainnet — balances via GraphQL, prices via CoinGecko.
//
// JSON-RPC (`suix_getAllBalances`, `suix_getCoinMetadata`) was disabled on
// public fullnodes and now answers every method with -32601 "Method not found",
// so balances come from the GraphQL RPC instead. See
// https://docs.sui.io/develop/accessing-data/json-rpc-migration
//
// Two CoinGecko quirks drove the pricing approach:
//  1) The free-tier `simple/token_price/sui` endpoint only accepts one
//     contract_address per request (error 10012), so batching fails for
//     wallets holding multiple Sui coins.
//  2) CoinGecko stores Sui platform addresses in fully 32-byte-padded form
//     (e.g. `0x0000…0002::sui::SUI` for native SUI), and some sources use the
//     short canonical form (`0x2::sui::SUI`). Direct string matching would
//     miss the native coin entirely.
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

const GRAPHQL_URL = "https://graphql.mainnet.sui.io/graphql";
const UA = "Mozilla/5.0 (compatible; crypto-portfolio/1.0)";

// GraphQL caps `first` at 50 per page. Cap the walk too: scam-targeted wallets
// accumulate hundreds of dust coin types, and one bounded RPC call must not
// turn into an unbounded pagination loop on every refresh.
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

type GqlBalance = { coinType: { repr: string } | null; totalBalance: string | null };
type CoinMetadata = { decimals: number; symbol: string } | null;

const BALANCES_QUERY = `query($a: SuiAddress!, $after: String) {
  address(address: $a) {
    balances(first: ${PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { coinType { repr } totalBalance }
    }
  }
}`;

const METADATA_QUERY = `query($t: String!) {
  coinMetadata(coinType: $t) { decimals symbol }
}`;

// GraphQL answers 200 OK even for validation and rate-limit failures, putting
// the reason in `errors` with a null `data`. Throw on both — letting either
// fall through would silently zero the Sui position instead of surfacing a
// warning through `safeSui`.
async function gql<T>(label: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Sui GraphQL ${label} ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json().catch(() => null);
  const errors = (j as any)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`Sui GraphQL ${label}: ${String(errors[0]?.message ?? "unknown error")}`);
  }
  if (j == null || (j as any).data == null) {
    throw new Error(`Sui GraphQL ${label}: empty response`);
  }
  return (j as any).data as T;
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

// Coin metadata (decimals, symbol) is immutable per coin type, so cache it hard
// and skip a per-coin RPC round-trip on every 90s refresh. Falls back to null
// when the endpoint has never succeeded, matching the previous behavior.
function fetchCoinMetadata(coinType: string): Promise<CoinMetadata> {
  return memoize(`sui-meta:${coinType}`, 6 * 60 * 60 * 1000, () =>
    gql<{ coinMetadata: CoinMetadata }>("coinMetadata", METADATA_QUERY, { t: coinType }).then(
      (d) => d.coinMetadata,
    ),
  )
    .then((r) => r.value)
    .catch(() => null);
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

type Balance = { coinType: string; totalBalance: string };

type BalancesPage = {
  address: {
    balances: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GqlBalance[];
    };
  } | null;
};

/** Walk the paginated `balances` connection, bounded by MAX_PAGES. */
async function fetchAllBalances(address: string): Promise<Balance[]> {
  const out: Balance[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    // Annotated explicitly: `after` is assigned from `d` below, and without it
    // TypeScript hits a circular inference between the two (TS7022).
    const d: BalancesPage = await gql<BalancesPage>("balances", BALANCES_QUERY, { a: address, after });

    // `address` is nullable in the schema. Treat a null node as a failure
    // rather than an empty wallet, so we warn instead of silently zeroing.
    if (d.address == null) throw new Error("Sui GraphQL balances: no address node in response");

    const conn = d.address.balances;
    for (const n of conn?.nodes ?? []) {
      const coinType = n.coinType?.repr;
      if (coinType && n.totalBalance) out.push({ coinType, totalBalance: n.totalBalance });
    }
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

async function rawSui(address: string): Promise<SuiResult> {
  const balances = await fetchAllBalances(address);
  // Drop zero balances early — scam-targeted wallets can accumulate hundreds
  // of dust coin types that would otherwise flood per-coin metadata calls.
  const nonZero = balances.filter((b) => b.totalBalance !== "0");
  if (nonZero.length === 0) return { totalUsd: 0, positions: [] };

  const [metas, coinMapRes] = await Promise.all([
    Promise.all(nonZero.map((b) => fetchCoinMetadata(b.coinType))),
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
