"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") ?? "/";
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (r.ok) {
        router.push(from);
        router.refresh();
        return;
      }
      const j = await r.json().catch(() => ({}));
      setErr(j?.error ?? "로그인 실패");
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xs">
      <div className="mb-12 text-center">
        <div className="text-[11px] uppercase tracking-[0.25em] text-muted">Crypto</div>
        <div className="display text-3xl mt-1">Portfolio</div>
      </div>
      <label className="block">
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted">Password</span>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          autoComplete="current-password"
          className="mt-2 w-full bg-transparent border-b border-ink py-2 text-lg focus:outline-none caret-ink"
        />
      </label>
      {err && <p className="mt-3 text-xs text-loss">{err}</p>}
      <button
        type="submit"
        disabled={loading || !pw}
        className="mt-10 w-full border border-ink py-2 text-[11px] uppercase tracking-[0.25em] hover:bg-ink hover:text-paper transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "..." : "Enter"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-dvh flex items-center justify-center bg-paper text-ink px-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
