export type Config = {
  id: number;
  total_deposit_krw: number;
  evm_address: string | null;
  solana_address: string | null;
  sui_address: string | null;
  stable_qty: number;
  mega_qty: number;
  updated_at: string;
};

export type PlatformBreakdown = {
  label: string;
  valueUsd: number;
  valueKrw: number;
  share: number;
};

export type PortfolioData = {
  asOf: string;
  totalUsd: number;
  totalKrw: number;
  usdKrwRate: number;
  megaPriceUsd: number;
  stablePriceUsd: number;
  breakdown: PlatformBreakdown[];
  totalDepositKrw: number;
  profitKrw: number;
  profitPct: number;
};

export type HistoryPoint = {
  taken_date: string;
  total_krw: number;
};
