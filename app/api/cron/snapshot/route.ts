import { NextResponse, type NextRequest } from "next/server";
import { computePortfolio } from "@/lib/portfolio";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const data = await computePortfolio();
    const today = new Date().toISOString().slice(0, 10);
    const sb = supabaseAdmin();
    const { error } = await sb.from("snapshots").upsert(
      {
        taken_date: today,
        total_usd: data.totalUsd,
        total_krw: data.totalKrw,
        usd_krw_rate: data.usdKrwRate,
        mega_price_usd: data.megaPriceUsd,
        stable_price_usd: data.stablePriceUsd,
        breakdown: data.breakdown,
      },
      { onConflict: "taken_date" },
    );
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      taken_date: today,
      total_krw: data.totalKrw,
      total_usd: data.totalUsd,
      warnings: data.warnings,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
