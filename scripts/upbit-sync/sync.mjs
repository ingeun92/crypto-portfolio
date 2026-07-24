#!/usr/bin/env node
// Upbit balance sync worker.
//
// Runs on a machine with a fixed public IP (registered in Upbit's API key
// allowlist), reads the account balances, and pushes them to the dashboard's
// ingest endpoint. Zero dependencies — plain Node 18+.
//
// Required environment:
//   UPBIT_ACCESS_KEY    Upbit Open API access key (asset-inquiry scope only)
//   UPBIT_SECRET_KEY    Upbit Open API secret key
//   SYNC_URL            https://<your-app>/api/upbit/sync
//   UPBIT_SYNC_SECRET   must match the same env var on the dashboard
//
// See README.md for VM setup and cron registration.

import { createHmac, randomUUID } from "node:crypto";

const { UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY, SYNC_URL, UPBIT_SYNC_SECRET } = process.env;

for (const [name, value] of Object.entries({
  UPBIT_ACCESS_KEY,
  UPBIT_SECRET_KEY,
  SYNC_URL,
  UPBIT_SYNC_SECRET,
})) {
  if (!value) {
    console.error(`[upbit-sync] missing env: ${name}`);
    process.exit(2);
  }
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Upbit expects HS512 over {access_key, nonce}. No query_hash here — the
// accounts endpoint takes no parameters. The secret key is used raw, not
// base64-decoded.
function authToken() {
  const header = base64url(JSON.stringify({ alg: "HS512", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ access_key: UPBIT_ACCESS_KEY, nonce: randomUUID() }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = base64url(
    createHmac("sha512", UPBIT_SECRET_KEY).update(signingInput).digest(),
  );
  return `${signingInput}.${signature}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One retry pass covers transient DNS/network blips on a small VM. Auth and
// allowlist failures are permanent, so those bail immediately.
// Node's fetch collapses transport failures into a bare "fetch failed"; the
// actual reason (DNS, TLS, redirect replay) only lives on `cause`.
function describeError(e) {
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e.message} (${cause})` : String(e?.message ?? e);
}

async function withRetry(label, fn) {
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e?.permanent || i === attempts) throw e;
      console.error(`[upbit-sync] ${label} attempt ${i} failed: ${describeError(e)} — retrying`);
      await sleep(1000 * i);
    }
  }
}

function permanent(message) {
  const e = new Error(message);
  e.permanent = true;
  return e;
}

async function fetchAccounts() {
  const r = await fetch("https://api.upbit.com/v1/accounts", {
    headers: { Authorization: `Bearer ${authToken()}`, Accept: "application/json" },
  });
  const text = await r.text();
  if (!r.ok) {
    const detail = text.slice(0, 300);
    // 401 means the IP allowlist ("no_authorization_i_p"), a wrong key
    // ("invalid_access_key"), or an expired key — none of which retrying fixes.
    // The upstream error name is included so the cause is unambiguous.
    if (r.status === 401) {
      throw permanent(
        `Upbit 401 — check the API key's allowed IP, key values, and expiry (keys last 1 year): ${detail}`,
      );
    }
    throw new Error(`Upbit HTTP ${r.status}: ${detail}`);
  }
  const accounts = JSON.parse(text);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw permanent("Upbit returned no accounts — refusing to push an empty payload");
  }
  return accounts;
}

async function push(accounts) {
  const r = await fetch(SYNC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPBIT_SYNC_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ accounts }),
    // Following a redirect would replay the body and surface as an opaque
    // "fetch failed". A 3xx here means the route isn't deployed (middleware
    // bounces unknown paths to /login), so report that instead.
    redirect: "manual",
  });
  if (r.status >= 300 && r.status < 400) {
    throw permanent(
      `sync endpoint redirected (${r.status} → ${r.headers.get("location")}) — ` +
        `is /api/upbit/sync deployed, and is SYNC_URL correct?`,
    );
  }
  const text = await r.text();
  if (!r.ok) {
    if (r.status === 401) {
      throw permanent(`sync endpoint 401 — UPBIT_SYNC_SECRET mismatch: ${text.slice(0, 200)}`);
    }
    throw new Error(`sync endpoint HTTP ${r.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

try {
  const accounts = await withRetry("fetch", fetchAccounts);
  await withRetry("push", () => push(accounts));
  console.log(`[upbit-sync] ${new Date().toISOString()} synced ${accounts.length} balances`);
} catch (e) {
  console.error(`[upbit-sync] failed: ${describeError(e)}`);
  process.exit(1);
}
