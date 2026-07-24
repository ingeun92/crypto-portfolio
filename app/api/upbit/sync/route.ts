import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { constantTimeEqual } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ingest endpoint for the fixed-IP sync worker (scripts/upbit-sync). The worker
// holds the Upbit API keys and posts the raw `/v1/accounts` response here; this
// route normalizes and stores it. Keeping the secret on the worker means it
// never lands in Vercel's environment or the browser.

type Account = {
  currency?: unknown;
  balance?: unknown;
  locked?: unknown;
  avg_buy_price?: unknown;
  unit_currency?: unknown;
};

const CURRENCY_RE = /^[A-Z0-9]{1,20}$/;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.UPBIT_SYNC_SECRET}`;
  if (!process.env.UPBIT_SYNC_SECRET || !constantTimeEqual(auth ?? "", expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const accounts: Account[] | null = Array.isArray(body?.accounts) ? body.accounts : null;
  if (!accounts) {
    return NextResponse.json({ error: "accounts array required" }, { status: 400 });
  }
  // An empty payload would wipe every balance. A live Upbit account always
  // reports at least a KRW row, so treat empty as a worker bug, not a state.
  if (accounts.length === 0) {
    return NextResponse.json({ error: "refusing to sync an empty account list" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const rows = [];
  for (const a of accounts) {
    const currency = String(a?.currency ?? "").toUpperCase();
    if (!CURRENCY_RE.test(currency)) continue;
    rows.push({
      currency,
      balance: num(a?.balance),
      locked: num(a?.locked),
      avg_buy_price: num(a?.avg_buy_price),
      unit_currency: String(a?.unit_currency ?? "KRW").toUpperCase().slice(0, 10),
      updated_at: now,
    });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "no valid accounts in payload" }, { status: 400 });
  }

  try {
    const sb = supabaseAdmin();
    const { error: upsertErr } = await sb
      .from("upbit_balances")
      .upsert(rows, { onConflict: "currency" });
    if (upsertErr) throw upsertErr;

    // Fully sold-out coins drop out of the Upbit response entirely; without this
    // they would linger as phantom holdings. Currency codes are regex-checked
    // above, so the filter list is safe to interpolate.
    const kept = rows.map((r) => r.currency).join(",");
    const { error: deleteErr } = await sb
      .from("upbit_balances")
      .delete()
      .not("currency", "in", `(${kept})`);
    if (deleteErr) throw deleteErr;

    return NextResponse.json({ ok: true, count: rows.length, synced_at: now });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
