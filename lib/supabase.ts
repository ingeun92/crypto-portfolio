import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "./types";

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase env missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

const CONFIG_DEFAULT: Omit<Config, "updated_at"> = {
  id: 1,
  total_deposit_krw: 0,
  evm_address: null,
  solana_address: null,
  stable_qty: 0,
  mega_qty: 0,
};

/**
 * Read the singleton config row. If it does not exist yet (e.g. schema was
 * created but the seed INSERT was skipped), create it on-demand so the caller
 * always gets a valid Config back — avoids PGRST116 "Cannot coerce the result
 * to a single JSON object".
 */
export async function getOrCreateConfig(): Promise<Config> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("config")
    .select("*")
    .eq("id", 1)
    .maybeSingle<Config>();
  if (error) throw new Error(`config read failed: ${error.message}`);
  if (data) return data;

  const { data: inserted, error: insertErr } = await sb
    .from("config")
    .upsert({ ...CONFIG_DEFAULT, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select()
    .single<Config>();
  if (insertErr || !inserted) {
    throw new Error(`config seed failed: ${insertErr?.message ?? "unknown"}`);
  }
  return inserted;
}
