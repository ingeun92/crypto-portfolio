-- Single-row config table (enforced via CHECK constraint)
create table if not exists config (
  id integer primary key default 1,
  total_deposit_krw bigint not null default 0,
  evm_address text,
  solana_address text,
  sui_address text,
  stable_qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint config_singleton check (id = 1)
);

-- Additive migration for pre-existing deployments that predate sui_address.
alter table config add column if not exists sui_address text;
-- MEGA airdrop has shipped; the token now flows through Rabby's Zerion feed,
-- so the manual quantity column is no longer used.
alter table config drop column if exists mega_qty;
alter table snapshots drop column if exists mega_price_usd;

insert into config (id) values (1) on conflict do nothing;

-- Daily portfolio snapshots (one row per calendar day)
create table if not exists snapshots (
  id bigserial primary key,
  taken_at timestamptz not null default now(),
  taken_date date not null unique,
  total_usd numeric not null,
  total_krw numeric not null,
  usd_krw_rate numeric not null,
  stable_price_usd numeric,
  breakdown jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists snapshots_date_idx on snapshots (taken_date desc);

-- Upbit balances, written by the sync worker (scripts/upbit-sync). Upbit's
-- authenticated API requires an IP allowlist, which Vercel cannot satisfy —
-- so a fixed-IP box pushes quantities here and the app prices them with
-- Upbit's public quotation API. One row per currency, KRW included.
create table if not exists upbit_balances (
  currency text primary key,
  balance numeric not null default 0,
  locked numeric not null default 0,
  avg_buy_price numeric not null default 0,
  unit_currency text not null default 'KRW',
  updated_at timestamptz not null default now()
);

-- This app only talks to Supabase via the service_role key on the server, which
-- already bypasses RLS. Enabling RLS here only adds a footgun (misusing the
-- anon key becomes silently impossible to debug), so we leave it off. If you
-- later add browser-side anon access, flip these on and write explicit policies.
alter table config disable row level security;
alter table snapshots disable row level security;
alter table upbit_balances disable row level security;
