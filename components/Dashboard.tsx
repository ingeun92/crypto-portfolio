"use client";

import { useState } from "react";
import type { Config, HistoryPoint, PortfolioData } from "@/lib/types";
import { fmtKrw, fmtUsd, fmtPct, fmtKstDateTime } from "@/lib/format";
import { SettingsPanel } from "./SettingsPanel";
import { TrendChart } from "./TrendChart";

type Props = {
  data: (PortfolioData & { warnings?: string[] }) | null;
  error: string | null;
  config: Config;
  history: HistoryPoint[];
};

export function Dashboard({ data, error, config, history }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const gain = (data?.profitKrw ?? 0) >= 0;

  async function refresh() {
    setRefreshing(true);
    try {
      // Server page revalidation via router refresh — we just full-reload for simplicity.
      window.location.reload();
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/login";
  }

  return (
    <main className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-rule">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-baseline justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-[11px] uppercase tracking-[0.25em]">Crypto Portfolio</h1>
            <p className="mt-1 text-[11px] text-muted num" suppressHydrationWarning>
              {data ? fmtKstDateTime(data.asOf) : "—"}
            </p>
          </div>
          <div className="flex items-center gap-6 text-[11px] uppercase tracking-[0.15em] text-muted">
            {data && (
              <span>
                USD/KRW <span className="num text-ink ml-1">{data.usdKrwRate.toFixed(2)}</span>
              </span>
            )}
            <button onClick={refresh} disabled={refreshing} className="hover:text-ink disabled:opacity-40">
              {refreshing ? "…" : "Refresh"}
            </button>
            <button onClick={() => setShowSettings(true)} className="hover:text-ink">
              Settings
            </button>
            <button onClick={logout} className="hover:text-ink">
              Logout
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="mx-auto max-w-5xl px-6 pt-10 text-sm text-loss border-b border-rule pb-6">
          <div className="text-[10px] uppercase tracking-[0.2em] text-loss mb-2">Error</div>
          <div className="num break-words">{error}</div>
        </div>
      )}

      {data && (
        <>
          <section className="mx-auto max-w-5xl px-6 pt-14 pb-14 border-b border-rule">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted">Total Value</div>
            <div className="mt-5 grid grid-cols-1 md:grid-cols-[1fr_auto] items-end gap-x-14 gap-y-6">
              <div className="display text-[72px] md:text-[92px] leading-[0.95]">
                {fmtKrw(data.totalKrw)}
              </div>
              <div className="md:text-right">
                <div className={`display text-4xl md:text-5xl ${gain ? "text-gain" : "text-loss"}`}>
                  {fmtPct(data.profitPct)}
                </div>
                <div className={`mt-2 text-sm num ${gain ? "text-gain" : "text-loss"}`}>
                  {gain ? "▲" : "▼"} {fmtKrw(Math.abs(data.profitKrw))}
                </div>
                <div className="mt-6 text-[10px] uppercase tracking-[0.2em] text-muted">
                  vs deposit
                </div>
                <div className="mt-1 num text-sm">{fmtKrw(data.totalDepositKrw)}</div>
              </div>
            </div>
          </section>

          {history.length >= 2 && (
            <section className="mx-auto max-w-5xl px-6 py-10 border-b border-rule">
              <div className="flex items-baseline justify-between mb-6">
                <div className="text-[10px] uppercase tracking-[0.25em] text-muted">
                  Trend
                </div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-muted num">
                  {history.length}d
                </div>
              </div>
              <TrendChart data={history} gain={gain} />
            </section>
          )}

          <section className="mx-auto max-w-5xl px-6 py-10">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted mb-6">Breakdown</div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.15em] text-muted">
                    <th className="text-left pb-3 font-normal">Platform</th>
                    <th className="text-right pb-3 font-normal">USD</th>
                    <th className="text-right pb-3 font-normal">KRW</th>
                    <th className="text-right pb-3 font-normal w-20">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((row) => (
                    <tr key={row.label} className="border-t border-rule group">
                      <td className="py-4 text-[15px]">{row.label}</td>
                      <td className="py-4 text-right num text-sm">{fmtUsd(row.valueUsd)}</td>
                      <td className="py-4 text-right num text-sm">{fmtKrw(row.valueKrw)}</td>
                      <td className="py-4 text-right num text-sm text-muted">
                        {(row.share * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-ink">
                    <td className="py-4 text-[15px]">Total</td>
                    <td className="py-4 text-right num text-sm">{fmtUsd(data.totalUsd)}</td>
                    <td className="py-4 text-right num text-sm">{fmtKrw(data.totalKrw)}</td>
                    <td className="py-4 text-right num text-sm text-muted">100.0%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {data.warnings && data.warnings.length > 0 && (
            <section className="mx-auto max-w-5xl px-6 pb-10">
              <div className="text-[10px] uppercase tracking-[0.25em] text-loss mb-3">Warnings</div>
              <ul className="text-[12px] text-muted num space-y-1">
                {data.warnings.map((w, i) => (
                  <li key={i}>· {w}</li>
                ))}
              </ul>
            </section>
          )}

          <footer className="mx-auto max-w-5xl px-6 py-8 border-t border-rule text-[11px] text-muted flex justify-between flex-wrap gap-4">
            <div>
              <span className="uppercase tracking-[0.15em]">MEGA</span>{" "}
              <span className="num text-ink">${data.megaPriceUsd.toFixed(4)}</span>
              <span className="mx-3">·</span>
              <span className="uppercase tracking-[0.15em]">STABLE</span>{" "}
              <span className="num text-ink">${data.stablePriceUsd.toFixed(6)}</span>
            </div>
            <div className="uppercase tracking-[0.15em]">Snapshot daily 00:05 KST</div>
          </footer>
        </>
      )}

      {showSettings && (
        <SettingsPanel config={config} onClose={() => setShowSettings(false)} />
      )}
    </main>
  );
}
