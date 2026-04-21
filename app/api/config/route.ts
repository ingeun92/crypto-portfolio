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

const ALLOWED_KEYS = ["total_deposit_krw", "evm_address", "solana_address", "stable_qty", "mega_qty"] as const;

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const k of ALLOWED_KEYS) {
    if (k in body) patch[k] = body[k];
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
