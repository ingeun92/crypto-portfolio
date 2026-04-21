# crypto-portfolio

스프레드시트 없이 한 페이지로 보는 개인 크립토 자산 대시보드.
지갑 주소 기반 자동 집계 · Bybit $STABLE 고정수량 · $MEGA 실시간가 재계산 · 일 1회 스냅샷 · 추이 차트.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase (config 싱글톤 + 일별 snapshots)
- Zerion API (EVM + Solana 포트폴리오 집계)
- Bybit public API (`$MEGA` 선물가), CoinGecko (`$STABLE`), open.er-api.com (USD/KRW)
- Vercel 배포 + Vercel Cron(일 1회 UTC 15:05 = KST 00:05)

## Setup

### 1. Supabase

1. [supabase.com](https://supabase.com) 프로젝트 생성
2. **SQL Editor**에 `supabase/schema.sql` 내용 붙여넣고 실행
3. **Project Settings → API**에서
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` 키 → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ 서버 전용, 노출 금지)

### 2. Zerion API 키

1. [developers.zerion.io](https://developers.zerion.io) 가입 → API 키 발급
2. `ZERION_API_KEY`에 저장

### 3. 비밀번호와 시크릿

```bash
openssl rand -hex 32  # AUTH_SECRET 용
openssl rand -hex 32  # CRON_SECRET 용
```

`.env.local`:

```env
SITE_PASSWORD=본인이-쓸-비밀번호
AUTH_SECRET=위에서-생성한-hex
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
ZERION_API_KEY=zk_dev_...
CRON_SECRET=위에서-생성한-hex
```

### 4. 로컬 개발

```bash
npm install
npm run dev
# → http://localhost:3000  비밀번호 입력 후 대시보드 진입
```

최초 진입 후 **Settings** 패널에서
- 총 입금 금액 (₩)
- EVM 주소 (Rabby 연결된 지갑)
- Solana 주소 (Phantom)
- `$STABLE` 수량 (Bybit)
- `$MEGA` 수량

을 입력하면 즉시 자동 집계됩니다.

### 5. Vercel 배포

```bash
vercel
# 프로젝트 연결 후:
vercel env add SITE_PASSWORD production
vercel env add AUTH_SECRET production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add ZERION_API_KEY production
vercel env add CRON_SECRET production
vercel --prod
```

`vercel.json`의 `crons` 설정이 자동으로 인식되어 매일 **UTC 15:05 (KST 00:05)** 에 스냅샷이 저장됩니다.

## 데이터 집계 규칙

| 플랫폼 | 계산식 |
|---|---|
| Rabby (Net) | `zerion(EVM 주소).totalUsd − zerion에서 발견된 $MEGA 포지션 가치` |
| $MEGA · MegaETH | `mega_qty × Bybit MEGAUSDT linear lastPrice` |
| Phantom | `zerion(Solana 주소).totalUsd` |
| Bybit · $STABLE | `stable_qty × CoinGecko(stable-2) 가격` |
| **Total (KRW)** | `sum(USD) × open.er-api.com KRW rate` |
| 수익 | `총 KRW − 총 입금 KRW` |
| 수익률 | `수익 / 입금 × 100` |

$MEGA를 Rabby에서 빼고 다시 더하는 이유: Zerion 가격이 부정확해서 사용자가 검증한 **Bybit 선물 가격**으로 재계산하려는 것.

## 파일 구조

```
app/
  api/
    auth/route.ts          비밀번호 POST / 로그아웃 DELETE
    config/route.ts        설정 GET/PATCH
    portfolio/route.ts     실시간 집계 GET
    snapshots/route.ts     이력 조회
    cron/snapshot/route.ts 일 1회 저장 (CRON_SECRET 필요)
  login/page.tsx           비번 입력 화면
  layout.tsx, page.tsx, globals.css
components/
  Dashboard.tsx, SettingsPanel.tsx, TrendChart.tsx
lib/
  auth.ts       HMAC 서명 쿠키 (Edge 호환)
  supabase.ts   service_role 클라이언트
  prices.ts     Bybit/CoinGecko/FX fetch
  zerion.ts     포트폴리오 포지션 집계
  portfolio.ts  전체 계산 orchestration
  format.ts     KRW/USD/% 포매터
  types.ts
middleware.ts   /login, /api/auth, /api/cron 외는 쿠키 확인
supabase/schema.sql
vercel.json     cron 설정
```

## 보안 메모

- 모든 외부 API 키는 서버 라우트에서만 사용 (`NEXT_PUBLIC_*` 아님)
- Supabase 테이블은 RLS enabled + 정책 없음 → service role만 접근
- 사이트 전체가 middleware 쿠키 게이트로 보호됨
- 크론 엔드포인트는 `Authorization: Bearer CRON_SECRET` 검증

## 한계 · 개선 여지

- Zerion의 Solana 인덱싱이 드물게 빠르지 않아 Phantom 값이 늦을 수 있음 → 필요 시 Helius로 교체 가능
- Upbit/Bybit 전체 잔고 API 연동은 현재 미포함 (API 키 필요). 원하면 `lib/exchanges/`에 추가해 `portfolio.ts`에 파트 하나 더 붙이면 됨
- MEGA는 Bybit linear perpetual 기준. 실제 spot 거래 가격과 차이가 있을 수 있음 (현재 spot 미상장)
