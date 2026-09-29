// Shared CoinGecko fetch. The keyless public tier is blocked at the CDN
// (CloudFront 403 "Request blocked") for `simple/price`, so requests carry a
// free Demo key when COINGECKO_API_KEY is set. Demo keys use the same
// api.coingecko.com host; only Pro keys move to pro-api.coingecko.com.
const BASE = "https://api.coingecko.com/api/v3";
const UA = "Mozilla/5.0 (compatible; crypto-portfolio/1.0)";

export async function coingecko<T>(label: string, path: string): Promise<T> {
  const key = process.env.COINGECKO_API_KEY;
  const r = await fetch(`${BASE}${path}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...(key ? { "x-cg-demo-api-key": key } : {}),
    },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`CoinGecko ${label} HTTP ${r.status}`);
  return (await r.json()) as T;
}
