/**
 * Process-level stale-while-error cache.
 *
 * - Within TTL: return cached value, skip network.
 * - TTL expired: call `fn`; on success, refresh cache.
 * - TTL expired AND `fn` throws: serve the last good value if any (up to
 *   `maxStaleMs`), so transient rate-limits (e.g. Zerion 429) don't cause the
 *   dashboard to flash zeros between refreshes.
 *
 * Serverless note: the cache lives in the Node.js process, so a cold start
 * starts empty. For a personal dashboard this is fine — within a warm instance
 * we get perfect de-dup, and cold starts just pay one fresh fetch each.
 */

type Entry<T> = { value: T; at: number };

const store = new Map<string, Entry<unknown>>();

export async function memoize<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { maxStaleMs?: number } = {},
): Promise<{ value: T; stale: boolean; ageMs: number }> {
  const now = Date.now();
  const prev = store.get(key) as Entry<T> | undefined;
  if (prev && now - prev.at < ttlMs) {
    return { value: prev.value, stale: false, ageMs: now - prev.at };
  }
  try {
    const value = await fn();
    store.set(key, { value, at: now });
    return { value, stale: false, ageMs: 0 };
  } catch (e) {
    const maxStale = opts.maxStaleMs ?? 30 * 60 * 1000;
    if (prev && now - prev.at < maxStale) {
      return { value: prev.value, stale: true, ageMs: now - prev.at };
    }
    throw e;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
