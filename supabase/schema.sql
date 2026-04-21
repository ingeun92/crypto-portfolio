-- Single-row config table (enforced via CHECK constraint)
create table if not exists config (
  id integer primary key default 1,
  total_deposit_krw bigint not null default 0,
  evm_address text,
  solana_address text,
  sui_address text,
  stable_qty numeric not null default 0,
  mega_qty numeric not null default 0,
  updated_at timestamptz not null default now(),
  constraint config_singleton check (id = 1)
);

-- Additive migration for pre-existing deployments that predate sui_address.
alter table config add column if not exists sui_address text;

insert into config (id) values (1) on conflict do nothing;

-- Daily portfolio snapshots (one row per calendar day)
create table if not exists snapshots (
  id bigserial primary key,
  taken_at timestamptz not null default now(),
  taken_date date not null unique,
  total_usd numeric not null,
  total_krw numeric not null,
  usd_krw_rate numeric not null,
  mega_price_usd numeric,
  stable_price_usd numeric,
  breakdown jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists snapshots_date_idx on snapshots (taken_date desc);

-- This app only talks to Supabase via the service_role key on the server, which
-- already bypasses RLS. Enabling RLS here only adds a footgun (misusing the
-- anon key becomes silently impossible to debug), so we leave it off. If you
-- later add browser-side anon access, flip these on and write explicit policies.
alter table config disable row level security;
alter table snapshots disable row level security;
