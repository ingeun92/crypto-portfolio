export const COOKIE_NAME = "cp_session";

// Server-side token lifetime. Mirrors the cookie's maxAge so an in-window
// cookie stays valid, but — unlike the cookie's client-side expiry — this is
// enforced on verify, so a captured token can't outlive the window.
export const TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const bytes = new Uint8Array(sig);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export async function createToken(secret: string): Promise<string> {
  const payload = `v1.${Date.now()}`;
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [v, ts, sig] = parts;
  if (v !== "v1") return false;
  const expected = await hmacHex(secret, `${v}.${ts}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return false;

  // Signature is valid — now enforce freshness. The timestamp is HMAC-covered,
  // so it can't be forged; a stale (or non-numeric) one means an expired token.
  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt < TOKEN_MAX_AGE_MS;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
