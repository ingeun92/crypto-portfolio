# crypto-portfolio

스프레드시트 없이 한 페이지로 보는 개인 크립토 자산 대시보드.
지갑 주소 기반 자동 집계 · 업비트 잔고 자동 동기화 · Bybit $STABLE 고정수량 · 일 1회 스냅샷 · 추이 차트.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase (config 싱글톤 + 일별 snapshots + upbit_balances)
- Zerion API (EVM + Solana 포트폴리오 집계), Sui RPC (Sui 잔고)
- Upbit public API (원화 마켓 시세) + 고정 IP 워커의 인증 API 동기화
- CoinGecko (`$STABLE`), open.er-api.com (USD/KRW)
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
- Sui 주소 (Phantom)
- `$STABLE` 수량 (Bybit)

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
vercel env add UPBIT_SYNC_SECRET production
vercel --prod
```

`vercel.json`의 `crons` 설정이 자동으로 인식되어 매일 **UTC 15:05 (KST 00:05)** 에 스냅샷이 저장됩니다.

### 6. 업비트 연동 (선택)

업비트 인증 API는 API 키에 등록된 허용 IP에서만 호출할 수 있는데 Vercel은 egress IP가 고정되지 않습니다.
고정 IP를 가진 머신에서 잔고 수량만 주기적으로 밀어 넣고, 시세는 앱이 public API로 실시간 조회합니다.
설정 절차는 [`scripts/upbit-sync/README.md`](scripts/upbit-sync/README.md) 참고.

## 데이터 집계 규칙

| 플랫폼 | 계산식 |
|---|---|
| Rabby | `zerion(EVM 주소).totalUsd` |
| Phantom | `zerion(Solana 주소).totalUsd + sui(Sui 주소).totalUsd` |
| Upbit | `Σ (balance + locked) × Upbit KRW 마켓 현재가 ÷ USD/KRW` (KRW 예수금 제외) |
| Bybit · $STABLE | `stable_qty × CoinGecko(stable-2) 가격` |
| **Total (KRW)** | `sum(USD) × open.er-api.com KRW rate` |
| 입금 | `total_deposit_krw(업비트 외 수동) + 업비트 시드(자동)` |
| 업비트 시드 | `Σ(avg_buy_price × 수량)` — 코인 매수 원가만 |
| 수익 | `총 KRW − 총 입금 KRW` |
| 수익률 | `수익 / 입금 × 100` |

업비트 시드를 매수 원가에서 유도하는 이유: DCA 매수를 해도 입금액을 손으로 고칠 필요가 없다. 아직
코인이 되지 않은 **KRW 예수금은 자산 평가액과 시드 양쪽에서 모두 빠진다** — 한쪽에만 넣으면 예수금
전액만큼 수익이 왜곡되기 때문이다. 대시보드에는 제외된 예수금 액수를 참고용으로 표시한다. 단 매도하면
실현손익이 예수금으로 빠져나가면서 시드만 줄어들어 수익이 과대 계상되므로, 매도를 시작하면 입출금 조회
권한이 있는 키로 실제 입금 내역을 집계하는 방식으로 바꿔야 한다.

업비트만 KRW 기준이라 USD로 환산해 합산합니다. USD/KRW를 못 받아오면 잘못된 값을 더하지 않도록
해당 플랫폼을 `unavailable`로 처리합니다. `locked`(미체결 주문에 묶인 수량)도 보유 자산이므로 포함합니다.

## 파일 구조

```
app/
  api/
    auth/route.ts          비밀번호 POST / 로그아웃 DELETE
    config/route.ts        설정 GET/PATCH
    portfolio/route.ts     실시간 집계 GET
    snapshots/route.ts     이력 조회
    cron/snapshot/route.ts 일 1회 저장 (CRON_SECRET 필요)
    upbit/sync/route.ts    업비트 잔고 수신 (UPBIT_SYNC_SECRET 필요)
  login/page.tsx           비번 입력 화면
  layout.tsx, page.tsx, globals.css
components/
  Dashboard.tsx, SettingsPanel.tsx, TrendChart.tsx
lib/
  auth.ts       HMAC 서명 쿠키 (Edge 호환)
  supabase.ts   service_role 클라이언트
  prices.ts     CoinGecko/FX fetch
  zerion.ts     포트폴리오 포지션 집계
  sui.ts        Sui RPC 잔고 + CoinGecko 가격
  upbit.ts      동기화된 잔고 조회 + 원화 마켓 시세 평가
  portfolio.ts  전체 계산 orchestration
  format.ts     KRW/USD/% 포매터
  types.ts
scripts/
  upbit-sync/   고정 IP VM에서 도는 잔고 동기화 워커 (의존성 0)
middleware.ts   /login, /api/auth, /api/cron 외는 쿠키 확인
supabase/schema.sql
vercel.json     cron 설정
```

## 보안 메모

- 모든 외부 API 키는 서버 라우트에서만 사용 (`NEXT_PUBLIC_*` 아님)
- Supabase 테이블은 RLS enabled + 정책 없음 → service role만 접근
- 사이트 전체가 middleware 쿠키 게이트로 보호됨
- 크론 엔드포인트는 `Authorization: Bearer CRON_SECRET` 검증
- 업비트 동기화 엔드포인트는 `Authorization: Bearer UPBIT_SYNC_SECRET` 검증
- 업비트 API 키는 워커 VM에만 존재하고 Vercel·브라우저에는 올라가지 않음. 권한은 **자산조회 전용**

## 한계 · 개선 여지

- Zerion의 Solana 인덱싱이 드물게 빠르지 않아 Phantom 값이 늦을 수 있음 → 필요 시 Helius로 교체 가능
- 업비트 수량은 하루 한 번(23:30 KST) 갱신됨. 시세는 실시간이라 오차는 매수 직후부터 그날 밤 동기화까지만 발생
- 업비트 수집 종목은 워커의 `UPBIT_CURRENCIES` 화이트리스트로 제한됨. 새 종목 매수 시 이 값에 추가 필요
- 업비트 API 키는 유효기간 1년, 연장 불가 → 매년 재발급 후 워커 `.env` 교체 필요
- 원화 마켓이 없는 종목(BTC 마켓 전용 등)은 평가에서 제외되고 경고로 표시됨
- Bybit 잔고는 여전히 수동 (`$STABLE` 고정수량)
