import { computePortfolio } from "@/lib/portfolio";
import { getOrCreateConfig, supabaseAdmin } from "@/lib/supabase";
import { Dashboard } from "@/components/Dashboard";
import type { Config, HistoryPoint, PortfolioData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FALLBACK_CONFIG: Config = {
  id: 1,
  total_deposit_krw: 0,
  evm_address: null,
  solana_address: null,
  sui_address: null,
  stable_qty: 0,
  mega_qty: 0,
  updated_at: new Date().toISOString(),
};

export default async function Page() {
  let portfolio: (PortfolioData & { warnings: string[] }) | null = null;
  let error: string | null = null;
  try {
    portfolio = await computePortfolio();
  } catch (e: any) {
    error = String(e?.message ?? e);
  }

  let config: Config = FALLBACK_CONFIG;
  try {
    config = await getOrCreateConfig();
  } catch (e: any) {
    if (!error) error = String(e?.message ?? e);
  }

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const sb = supabaseAdmin();
  const { data: history } = await sb
    .from("snapshots")
    .select("taken_date,total_krw")
    .gte("taken_date", since)
    .order("taken_date", { ascending: true });

  return (
    <Dashboard
      data={portfolio}
      error={error}
      config={config}
      history={(history ?? []) as HistoryPoint[]}
    />
  );
}
