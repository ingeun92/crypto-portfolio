// Zerion REST API — works for EVM addresses and (as of late 2024) Solana.
// Docs: https://developers.zerion.io
import { memoize } from "./cache";

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

async function rawZerion(address: string, apiKey: string): Promise<ZerionResult> {
  const url =
    `https://api.zerion.io/v1/wallets/${encodeURIComponent(address)}/positions/` +
    `?currency=usd&filter[positions]=only_simple&filter[trash]=only_non_trash&page[size]=100`;

  const r = await fetch(url, {
    headers: {
      Authorization: basicAuth(apiKey),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Zerion ${r.status}: ${body.slice(0, 200)}`);
  }
  const j = await r.json();
  const rows: any[] = Array.isArray(j?.data) ? j.data : [];
  const positions: ZerionPosition[] = rows.map((p) => {
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
export function zerionPortfolio(address: string, apiKey: string) {
  if (!apiKey) throw new Error("ZERION_API_KEY missing");
  if (!address) return Promise.resolve({ value: { totalUsd: 0, positions: [] } as ZerionResult, stale: false, ageMs: 0 });
  return memoize(`zerion:${address}`, 90_000, () => rawZerion(address, apiKey));
}
