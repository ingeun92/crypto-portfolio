// Sui mainnet — balances via JSON-RPC, prices via CoinGecko's Sui token-price
// endpoint with a fallback to the native SUI coin price. Unknown coins are
// reported with valueUsd=0 so they show up without distorting totals.
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
const NATIVE_SUI = "0x2::sui::SUI";
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

async function fetchTokenPrices(coinTypes: string[]): Promise<Record<string, number>> {
  if (coinTypes.length === 0) return {};
  const url =
    "https://api.coingecko.com/api/v3/simple/token_price/sui" +
    `?contract_addresses=${encodeURIComponent(coinTypes.join(","))}&vs_currencies=usd`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) return {};
  const j = await r.json().catch(() => ({}));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j ?? {})) {
    const p = Number((v as any)?.usd);
    if (Number.isFinite(p)) out[k.toLowerCase()] = p;
  }
  return out;
}

async function fetchNativeSuiPrice(): Promise<number> {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd", {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) return 0;
  const j = await r.json().catch(() => ({}));
  const p = Number(j?.sui?.usd);
  return Number.isFinite(p) ? p : 0;
}

async function rawSui(address: string): Promise<SuiResult> {
  const balances = await rpc<RpcBalance[]>("suix_getAllBalances", [address]);
  if (!balances?.length) return { totalUsd: 0, positions: [] };

  const metas = await Promise.all(
    balances.map((b) => rpc<RpcMetadata>("suix_getCoinMetadata", [b.coinType]).catch(() => null)),
  );

  const [tokenPrices, nativePrice] = await Promise.all([
    fetchTokenPrices(balances.map((b) => b.coinType)),
    balances.some((b) => b.coinType === NATIVE_SUI) ? fetchNativeSuiPrice() : Promise.resolve(0),
  ]);

  const positions: SuiPosition[] = balances.map((b, i) => {
    const meta = metas[i];
    const decimals = meta?.decimals ?? 9;
    const symbol = (meta?.symbol ?? "").toUpperCase() || "UNKNOWN";
    const qty = Number(b.totalBalance) / Math.pow(10, decimals);
    let price = tokenPrices[b.coinType.toLowerCase()] ?? 0;
    if (!price && b.coinType === NATIVE_SUI) price = nativePrice;
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
