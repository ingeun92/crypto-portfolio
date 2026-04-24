// Zerion REST API — works for EVM addresses and (as of late 2024) Solana.
// Docs: https://developers.zerion.io
import { memoize, sleep } from "./cache";

export type ZerionPosition = {
  symbol: string;
  valueUsd: number;
  quantity: number;
};

export type ZerionResult = {
  totalUsd: number;
  positions: ZerionPosition[];
};

function basicAuth(apiKey: string): string {
  // Edge-runtime safe: btoa instead of Buffer.
  return "Basic " + btoa(`${apiKey}:`);
}

function parseRetryAfter(h: string | null): number {
  if (!h) return 0;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.min(n * 1000, 5_000);
  const when = Date.parse(h);
  if (Number.isFinite(when)) return Math.max(0, Math.min(when - Date.now(), 5_000));
  return 0;
}

async function rawZerion(address: string, apiKey: string, chainId?: string): Promise<ZerionResult> {
  const chainParam = chainId ? `&filter[chain_ids]=${encodeURIComponent(chainId)}` : "";
  const url =
    `https://api.zerion.io/v1/wallets/${encodeURIComponent(address)}/positions/` +
    `?currency=usd&filter[positions]=only_simple&filter[trash]=only_non_trash&page[size]=100${chainParam}`;

  // Free-tier Zerion throttles bursty refreshes with 429s. Retry a couple
  // times with exponential backoff (+ Retry-After hint) before giving up so
  // the memoize layer can still serve a stale value on a real outage.
  const maxAttempts = 3;
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await fetch(url, {
      headers: {
        Authorization: basicAuth(apiKey),
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (r.ok) return parseZerionResponse(await r.json());

    lastStatus = r.status;
    lastBody = await r.text().catch(() => "");
    const retriable = r.status === 429 || r.status === 503 || r.status === 502;
    if (!retriable || attempt === maxAttempts) break;
    const hinted = parseRetryAfter(r.headers.get("retry-after"));
    const backoff = hinted > 0 ? hinted : 500 * 2 ** (attempt - 1);
    await sleep(backoff);
  }
  throw new Error(`Zerion ${lastStatus}: ${lastBody.slice(0, 200)}`);
}

function parseZerionResponse(j: any): ZerionResult {
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];
  // Drop unverified fungibles. Zerion's `only_non_trash` filter still lets
  // through spoofed airdrops (e.g. a "JupEarnᥘio" / JUPE Solana token with a
  // bogus four-figure price) because Zerion hasn't classified them as trash
  // yet. Any real holding we care about on Solana/EVM is flagged verified=true
  // — combined unverified value on the user's EVM wallet is under $10.
  const positions: ZerionPosition[] = rows
    .filter((p) => p?.attributes?.fungible_info?.flags?.verified === true)
    .map((p) => {
      const attrs = p?.attributes ?? {};
      const fi = attrs.fungible_info ?? {};
      const value = Number(attrs.value ?? 0);
      const qty = Number(attrs.quantity?.numeric ?? 0);
      return {
        symbol: String(fi.symbol ?? "").toUpperCase(),
        valueUsd: Number.isFinite(value) ? value : 0,
        quantity: Number.isFinite(qty) ? qty : 0,
      };
    });
  const totalUsd = positions.reduce((a, b) => a + b.valueUsd, 0);
  return { totalUsd, positions };
}

/**
 * Cached wrapper. TTL 90s is chosen so multiple dashboard refreshes in a
 * short window don't burst Zerion and hit 429s on the free tier.
 */
export function zerionPortfolio(address: string, apiKey: string, chainId?: string) {
  if (!apiKey) throw new Error("ZERION_API_KEY missing");
  if (!address) return Promise.resolve({ value: { totalUsd: 0, positions: [] } as ZerionResult, stale: false, ageMs: 0 });
  // Extend the stale window to 2h: a brief Zerion 429 storm shouldn't flash
  // "unavailable" on the dashboard if we have any recent value to fall back on.
  const cacheKey = chainId ? `zerion:${address}:${chainId}` : `zerion:${address}`;
  return memoize(cacheKey, 90_000, () => rawZerion(address, apiKey, chainId), {
    maxStaleMs: 2 * 60 * 60 * 1000,
  });
}
