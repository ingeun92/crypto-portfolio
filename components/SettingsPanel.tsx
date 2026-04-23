"use client";

import { useState } from "react";
import type { Config } from "@/lib/types";

type Props = {
  config: Config;
  onClose: () => void;
};

type FormState = {
  total_deposit_krw: string;
  evm_address: string;
  solana_address: string;
  sui_address: string;
  stable_qty: string;
  mega_qty: string;
};

export function SettingsPanel({ config, onClose }: Props) {
  const [form, setForm] = useState<FormState>({
    total_deposit_krw: String(config.total_deposit_krw ?? 0),
    evm_address: config.evm_address ?? "",
    solana_address: config.solana_address ?? "",
    sui_address: config.sui_address ?? "",
    stable_qty: String(config.stable_qty ?? 0),
    mega_qty: String(config.mega_qty ?? 0),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function set<K extends keyof FormState>(k: K, v: string) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const payload = {
        total_deposit_krw: Number(form.total_deposit_krw) || 0,
        evm_address: form.evm_address.trim() || null,
        solana_address: form.solana_address.trim() || null,
        sui_address: form.sui_address.trim() || null,
        stable_qty: Number(form.stable_qty) || 0,
        mega_qty: Number(form.mega_qty) || 0,
      };
      const r = await fetch("/api/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      window.location.reload();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink/30 flex items-start justify-end z-50 animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <aside
        className="h-dvh w-full max-w-md bg-paper border-l border-rule px-5 py-6 sm:p-8 overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between mb-8 sm:mb-10">
          <h2 className="text-[11px] uppercase tracking-[0.25em]">Settings</h2>
          <button
            onClick={onClose}
            className="text-[11px] uppercase tracking-[0.2em] text-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="space-y-8">
          <Section title="Deposit">
            <Field
              label="Total Deposit (KRW)"
              value={form.total_deposit_krw}
              onChange={(v) => set("total_deposit_krw", v)}
              type="number"
            />
          </Section>

          <Section title="Wallets">
            <Field
              label="EVM Address · Rabby"
              value={form.evm_address}
              onChange={(v) => set("evm_address", v)}
              placeholder="0x…"
              mono
            />
            <Field
              label="Solana Address · Phantom"
              value={form.solana_address}
              onChange={(v) => set("solana_address", v)}
              mono
            />
            <Field
              label="Sui Address · Phantom"
              value={form.sui_address}
              onChange={(v) => set("sui_address", v)}
              placeholder="0x…"
              mono
            />
          </Section>

          <Section title="Fixed Holdings">
            <Field
              label="$STABLE Quantity · Bybit"
              value={form.stable_qty}
              onChange={(v) => set("stable_qty", v)}
              type="number"
            />
            <Field
              label="$MEGA Quantity · MegaETH"
              value={form.mega_qty}
              onChange={(v) => set("mega_qty", v)}
              type="number"
            />
          </Section>
        </div>

        {err && <p className="mt-6 text-xs text-loss num">{err}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="mt-10 w-full border border-ink py-2.5 text-[11px] uppercase tracking-[0.25em] hover:bg-ink hover:text-paper transition disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>

        <p className="mt-8 text-[10px] text-muted leading-relaxed">
          주소를 저장하면 Zerion API를 통해 자동으로 잔고가 집계됩니다. 고정 수량은 Bybit($STABLE) 및 Rabby의
          $MEGA 가치를 실시간 가격으로 재계산할 때 사용됩니다.
        </p>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted mb-4">{title}</div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={type === "number" ? "decimal" : undefined}
        step={type === "number" ? "any" : undefined}
        className={`mt-2 w-full bg-transparent border-b border-rule py-2 text-[15px] ${
          mono ? "num text-[13px]" : ""
        } focus:outline-none focus:border-ink caret-ink`}
      />
    </label>
  );
}
