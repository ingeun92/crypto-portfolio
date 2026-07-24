# Upbit 잔고 동기화 워커

업비트 인증 API는 **API 키에 등록된 허용 IP에서만** 호출할 수 있는데, Vercel은 egress IP가 고정되지 않습니다.
그래서 고정 IP를 가진 작은 머신이 잔고(수량)만 주기적으로 읽어 대시보드로 밀어 넣고, **가격은 Vercel이
업비트 public API로 실시간 조회**합니다. 시세는 앱이 처리하므로 이 워커는 1시간에 한 번만 돌면 충분합니다.

```
[Oracle VM · 고정 IP]  cron 매시 정각
   GET /v1/accounts (JWT 인증)
        ↓ POST /api/upbit/sync
   Supabase: upbit_balances
        ↓
[Vercel]  수량 읽기 + GET /v1/ticker (인증 불필요) → 실시간 평가액
```

API 시크릿은 이 워커에만 존재합니다. Vercel 환경변수나 브라우저에는 절대 올라가지 않습니다.

---

## 1. Supabase 스키마 적용

`supabase/schema.sql`을 SQL Editor에서 다시 실행합니다. 기존 테이블은 `if not exists`라 그대로 두고
`upbit_balances`만 새로 생성됩니다.

## 2. 공유 시크릿 발급

```bash
openssl rand -hex 32
```

이 값을 **양쪽에 동일하게** 넣습니다.

```bash
vercel env add UPBIT_SYNC_SECRET production
vercel --prod
```

## 3. Oracle Cloud Always Free VM 만들기

1. [cloud.oracle.com](https://cloud.oracle.com) 가입 (카드 인증은 필요하지만 Always Free 자원은 과금되지 않습니다)
2. **Compute → Instances → Create instance**
   - Image: Ubuntu 24.04
   - Shape: `VM.Standard.E2.1.Micro` 또는 Ampere `VM.Standard.A1.Flex` (둘 다 Always Free)
   - SSH 공개키 등록
3. **공인 IP를 고정(reserved)으로 전환** — 이 단계를 빼먹으면 재부팅 시 IP가 바뀝니다.
   인스턴스 상세 → **Attached VNICs** → VNIC 선택 → **IPv4 Addresses** → 기존 공인 IP **Edit** →
   `Reserved public IP` 선택 → 새 예약 IP 생성. Always Free 티어에 예약 IP 1개가 영구 포함됩니다.
4. 확정된 IP를 메모합니다.

## 4. 업비트 API 키 발급

업비트 **PC 웹** → 마이페이지 → **Open API 관리**

- 권한은 **자산조회만** 체크합니다. 주문·출금은 절대 켜지 마세요. 유출되더라도 조회만 가능합니다.
- **허용 IP**에 3단계에서 확보한 VM 공인 IP를 입력합니다.
- 발급 후 **Secret key는 다시 볼 수 없으니** 즉시 저장하세요.

> 업비트 API 키는 **유효기간 1년, 연장 불가**입니다. 만료되면 새로 발급받아 VM의 `.env`만 교체하면 됩니다.

## 5. VM에 워커 설치

```bash
ssh ubuntu@<VM_공인_IP>

sudo apt update && sudo apt install -y nodejs
node --version          # v18 이상이어야 합니다

mkdir -p ~/upbit-sync && cd ~/upbit-sync
# 로컬에서: scp scripts/upbit-sync/sync.mjs ubuntu@<VM_공인_IP>:~/upbit-sync/
```

Ubuntu 저장소의 Node가 18 미만이면 [NodeSource](https://github.com/nodesource/distributions)로 설치하세요.

`~/upbit-sync/.env`:

```env
UPBIT_ACCESS_KEY=발급받은-access-key
UPBIT_SECRET_KEY=발급받은-secret-key
SYNC_URL=https://<배포된-도메인>/api/upbit/sync
UPBIT_SYNC_SECRET=2단계에서-만든-hex
```

```bash
chmod 600 ~/upbit-sync/.env
```

`~/upbit-sync/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a; source ./.env; set +a
exec node sync.mjs
```

```bash
chmod +x ~/upbit-sync/run.sh
./run.sh          # 수동 실행으로 먼저 확인
```

성공하면 `[upbit-sync] 2026-07-24T02:00:00.000Z synced 7 balances` 같은 줄이 출력됩니다.

## 6. cron 등록

```bash
crontab -e
```

```cron
0 * * * * /home/ubuntu/upbit-sync/run.sh >> /home/ubuntu/upbit-sync/sync.log 2>&1
```

매시 정각에 동기화됩니다. 매매 직후 바로 반영하고 싶으면 `./run.sh`를 수동 실행하면 됩니다.

---

## 문제 해결

**`Upbit 401 — check the API key's allowed IP and expiry`**

허용 IP 불일치가 대부분입니다. VM에서 실제 나가는 IP를 확인하고 업비트 등록값과 대조하세요.

```bash
curl -s https://checkip.amazonaws.com
```

키가 1년을 넘겼다면 재발급이 필요합니다. 하나의 키에 최대 10개까지 IP를 등록할 수 있으니, 집 PC에서도
돌리고 싶다면 IP를 추가하면 됩니다.

**`sync endpoint 401 — UPBIT_SYNC_SECRET mismatch`**

VM의 `.env` 값과 Vercel 환경변수가 다릅니다. Vercel에서 값을 바꿨다면 재배포해야 반영됩니다.

**대시보드에 `Upbit: no synced balances yet`**

워커가 아직 한 번도 성공하지 못한 상태입니다. `~/upbit-sync/sync.log`를 확인하세요.

**대시보드에 `Upbit: balances last synced 5h old`**

cron이 멈췄거나 VM이 내려간 상태입니다. 표시되는 값은 마지막으로 동기화된 수량 기준입니다.

**대시보드에 `Upbit: no KRW market for XXX — excluded`**

원화 마켓이 없는 종목(예: BTC 마켓 전용 코인)이라 평가에서 제외됐다는 뜻입니다.
