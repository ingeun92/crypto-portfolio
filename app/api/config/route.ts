import { NextResponse, type NextRequest } from "next/server";
import { getOrCreateConfig, supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cfg = await getOrCreateConfig();
    return NextResponse.json(cfg);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

// Numeric columns and free-text address columns are validated separately: the
// client sanitizes too, but that is bypassable with a direct PATCH, so coerce
// and bound every field here before it reaches the DB.
const NUMERIC_KEYS = ["total_deposit_krw", "stable_qty"] as const;
const ADDRESS_KEYS = ["evm_address", "solana_address", "sui_address"] as const;
const MAX_ADDRESS_LEN = 128;

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  for (const k of NUMERIC_KEYS) {
    if (!(k in body)) continue;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `${k} must be a non-negative number` }, { status: 400 });
    }
    // total_deposit_krw is a bigint column — keep it integral.
    patch[k] = k === "total_deposit_krw" ? Math.round(n) : n;
  }

  for (const k of ADDRESS_KEYS) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null || v === "") {
      patch[k] = null;
      continue;
    }
    if (typeof v !== "string" || v.length > MAX_ADDRESS_LEN) {
      return NextResponse.json({ error: `${k} must be a string under ${MAX_ADDRESS_LEN} chars` }, { status: 400 });
    }
    patch[k] = v.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no allowed fields" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  try {
    // Ensure the row exists first so the UPDATE can never hit zero rows.
    await getOrCreateConfig();
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("config")
      .update(patch)
      .eq("id", 1)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
