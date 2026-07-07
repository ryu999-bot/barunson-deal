# 바른라운지 업체 관리자 — 기술 PRD (Technical PRD)

- **제품명:** 바른라운지 업체 관리자 (Partner Admin)
- **운영사:** (주)바른손카드
- **문서 버전:** v0.2 (donald-duck 접근·스택 확정 반영)
- **기준일:** 2026-07-07
- **자매 문서:** [기능_PRD.md](기능_PRD.md) · [연동_명세_초안_20260707.md](연동_명세_초안_20260707.md) · [계약서_수정안_20260707.md](계약서_수정안_20260707.md)

> 본 문서는 **"어떻게 만드는가(스택·아키텍처·DB·로드맵)"**를 다룬다. **"무엇을 만드는가(기능)"**는 [기능_PRD.md](기능_PRD.md) 참조.
>
> **v0.2 주요 변경:** ① 목표 스택 미확정(TBD) → **확정**(donald-duck 접근 완료). ② 3주 정렬 로드맵 신설(§11). ③ donald-duck 흡수 아키텍처 신설(§12). ④ 바른손카드 DB 설계 신설(§13).

---

## 1. 관련 시스템 지형 (System Landscape)

| 시스템 | 레포 | 역할 | 스택 |
|--------|------|------|------|
| **파트너 어드민** (본 제품) | `ryu999-bot/barunson-deal` | 업체·직원 운영 콘솔 | 현: Vite+바닐라TS / 목표: donald-duck 정렬 |
| **바른손카드 플랫폼** | `barunntechnicaloffice/donald-duck` | 회사 표준 이커머스 플랫폼 (청첩장·답례품·꽃·굿즈). **흡수 대상** | NestJS 11 + Next.js 15 + Prisma/Postgres |
| **바른손카드 레거시 DB** | `starlog/barunson-database-reference` | 결제·쿠폰 발급·정산의 **단일 진실원천**(source of truth) | MSSQL Azure(barunson/bar_shop1), MySQL(DD) |

- **관계:** 파트너 어드민과 donald-duck은 **같은 운영사의 다른 제품 라인**. 어드민은 스택 정렬 후 donald-duck에 도메인으로 흡수.
- **데이터 원천:** 쿠폰 상태·정산 금액의 계산 주체는 **바른손카드 1곳**. 어드민은 뷰 + 사용처리 트리거.

## 2. 데이터 모델 (현행 타입 기준)

```ts
CouponType = 'service' | 'amount' | 'count'   // 일반형 | 금액형 | 횟수형
CouponStatus = 'available' | 'used' | 'refunded'
BranchKind = 'direct' | 'franchise'           // 직영 | 가맹
Branch { id, name, kind, payee }              // payee = 정산주체(직영은 본사 공통)
Coupon { code, type, product, name, phone, buyDate, expire, paid,
         origin?, face?, used?, status, usedAt?, usedBy?,
         branchId?, usedBranchId?, history?: UsageEntry[] }  // branchId=구매지점, usedBranchId=사용처리지점
UsageEntry { date, amount, branchId? }        // branchId = 처리 지점(정산 귀속)

Role = 'vendor' | 'staff'
User { email, name, provider('email'|'google'), role, pw?, phone?, bizNo?,
       vendorName?(사업자명=정산주체), branchIds?(지점 스코프), issuedAt?, profile?: VendorProfile }
IssueInput { email, name, pw, vendorName, bizNo?, branchIds }  // 직원 계정 발급 (발급제 — 자가 가입 없음)
VendorProfile { bank, account, holder, company, ceo, addr, bizType, bizItem, taxEmail, phone }
SmsEntry { at, phone, message, kind('redeem'|'deduct'|'used-up') }
Notice { id, title, date, body, pinned? }
OpsVendorStat { vendor, region, revenue, issued, used, settle }
SettleLine { code, product, type, usedAt, usedAmount, settle, payout, branchId }  // 정산 산출
PayeeGroup { payee, kind, branchNames, count, total }  // 정산주체별 합산
```

## 3. 핵심 로직 스펙 (정산)

### 3.1 사용 기준 정산 (익월 25일)
- **기준:** 매월 1일~말일 **사용(사용처리·차감)**분을 **익월 25일**에 등록 계좌로 지급(`PAYOUT_DAY=25`). 휴일이면 직전 영업일.
- **유형별 정산액**
  - 일반형: 사용처리 시 **판매가(paid) 전액**.
  - 금액형: 차감할 때마다 **차감 액면 × (결제액 ÷ 액면)**. (예: 결제 20만/액면 100만 → 비율 20%. 30만 차감 → 6만)
  - 횟수형(`face`=총회수, `used`=사용회수): **사용회수 × 회당단가(결제액 ÷ 총회수)**. **완주 시 마지막 회차 끝수 보정**(정산 누계 = 결제액, 반올림 오차 방지. 예: 3회권 10만 → 33,333+33,333+33,334).
- **미사용분 정산 안 함** → 환불로 인한 업체 역정산 없음.
- 산출 함수: `domain.settleLines(coupons)`, 지급일 `domain.payoutDate(usedAt)`.

### 3.2 다지점(직영·가맹) 사용 범위와 정산
- **사용 범위 규칙 (2026-07-07 확정):** 쿠폰은 **판매 지점(`branchId`)을 운영하는 사업자(정산주체)의 지점에서만 사용 가능**.
  - 직영 계열(사업자 1개·지점 다수): 직영 지점 간 **교차 사용 가능** — 처리 지점만 선택.
  - 가맹점 쿠폰: **해당 가맹점 전용**. 타 사업자 계정에는 검색되지 않고(사용처리 검색이 사업자 스코프), 사용 가능 지점 안내만 표시.
  - 구현: `payeeOf(coupon)` ∈ 계정의 payee 집합(`canRedeem`) — 검색 필터 + 상세 가드 이중 차단. **서버 redeem/deduct API에서도 동일 검증 필수.**
- **귀속 규칙:** 정산 라인은 **사용처리한 지점**(`usedBranchId` / `history[].branchId`)에 귀속(직영 계열 내 지점별 실적 구분용).
- **지급:** 지점 → 정산주체(payee) 매핑. 직영 사용분은 **본사 계좌로 합산 지급**, 가맹 사용분은 **각 가맹점 계좌로 개별 지급**(플랫폼 직접 지급 — 본사 경유 재분배 없음). 세금계산서도 사업자별 발행.
- 산출 함수: `domain.groupByPayee(settleLines)`. 지점 데이터: `config.BRANCHES`, `config.branchOf(id)`.

### 3.3 상태/표시
- `realStatus`: refunded → (금액형 잔액0 → used) → used → 만료 → available.
- `balanceOf`(금액형 잔액), `discPct`(일반형 할인율), `refundDue`(만료 미사용 90%).

## 4. 아키텍처 · 기술 스택

### 4.1 현행 (프로토타입 — M0 파일럿 기반)
- **Vite 6 + TypeScript(바닐라)** + 자체 CSS(디자인 토큰). 정적 SPA.
- 모듈: `index.html` · `src/style.css` · `src/types.ts` · `src/config.ts` · `src/domain.ts`(순수 로직) · `src/api.ts`·`src/auth.ts`(**연동 시임, 현 localStorage 목**) · `src/main.ts`(UI).
- 빌드: `npm run dev`(HMR) / `npm run build`(dist).

### 4.2 목표 스택 (확정 — donald-duck 정렬)
> v0.1의 TBD 해소. donald-duck 접근 완료로 스택 확정.

| 레이어 | 목표 |
|--------|------|
| 프론트 | **Next.js 15** (App Router), TypeScript strict, **Tailwind v4**, **Zustand**, **TanStack Query v5** |
| 백엔드 | **NestJS 11**, **Prisma**(PostgreSQL 16), class-validator DTO, Swagger, JWT+Passport |
| 인증 | JWT (Access 15분 + Refresh 30일 RTR), 직원 Google 로그인 |
| 외부연계 | **Port & Adapter** — 바른손카드 MSSQL을 외부 시스템으로 격리 |
| 알림 | Notification 엔진(SMS/카카오 알림톡) |
| 인프라 | Docker Compose(로컬), 정적/컨테이너 배포 |

### 4.3 연동 계층(Seam) — 목 → 실제 API 매핑
| 현행(목) | 실제 연동 |
|----------|-----------|
| `api.listCoupons()` | `GET /partner/v1/vouchers` (바른손 발급·상태 동기화, **사업자 스코프**) |
| `api.redeem(code,branchId)` / `deduct(code,amount,branchId)` | `POST /partner/v1/vouchers/{code}/redeem` · `/deduct` (**멱등키 필수 + 사업자 스코프 검증**, 409=이미사용, 422=잔여초과) |
| `api.sendSms()` | 본사 사용처리 이벤트 후킹 자동 발송 or `POST /sms` |
| `api.getOpsStats()` | `GET /partner/v1/ops/stats` |
| `api.listNotices/addNotice/deleteNotice` | `GET/POST/DELETE /partner/v1/notices` |
| `api.sendInquiry()` | `POST /partner/v1/inquiries` (현 mailto) |
| `auth.login/loginWithGoogle` | `POST /auth/*` (세션/JWT), Google ID 토큰 서버 검증 |
| `auth.issueAccount/revokeAccount` | `POST/DELETE /partner/v1/accounts` (직원 콘솔 — 사업자별 계정 발급/회수, 자가 가입 없음) |
| `auth.updateProfile` | `PUT /partner/v1/vendor/profile` |
| 정산 산출/명세 | `GET /partner/v1/settlements?month=` (`domain.settleLines` 서버 이전) |
| (신규) 환불 반영 | 웹훅 `voucher.refunded` 또는 폴링 |

## 5. 외부 연동
- **인증:** Google OAuth 2.0(직원용) + 이메일/비밀번호.
- **SMS/알림톡:** 문자 게이트웨이(알리고/NHN/Twilio) 또는 본사 게이트웨이. 발송결과·실패·이력 저장.
- **정산/지급:** 바른손카드 결제원장 동기화 → 정산 산출 → 지급 실행(대행 vs 펌뱅킹, §14).
- **세금계산서:** 국세청 연동 또는 바른손 발행 대행.

## 6. 보안 · 개인정보 (PIPA)
- **PII 최소 노출:** 미사용 쿠폰의 고객명·연락처 어드민 노출 금지. 사용 시점(제시·조회)에만 표시(`transacted()` 게이트). API 응답 레벨 필터링.
- 연락처 마스킹, RBAC, 비밀번호 정책(8+특수문자, 서버 해시).
- 사업자등록증 등 파일은 서버 스토리지 업로드(현 파일명만 목).
- 바른손카드 DB 참조 시 마스킹 규칙 준수(`db-ref/CLAUDE.md`): 이름 `홍*임`, 연락처 `010-****-5678`, 계좌 뒤4자리.

## 7. 비기능 요구사항
- 반응형(모바일 매장), 접근성(reduced-motion), 브라우저 최신 2버전.
- 기준일: 현 `BASE_DATE` 고정(데모) → 연동 시 `new Date()`.

---

## 11. 스택 정렬 로드맵 (신설)

**핵심 제약:** 차주 출시(M0) · donald-duck 3주 후 착수 · 완전 정렬은 2~3주 소요 → **동시 만족 불가**. 따라서 단계 분리.

| 마일스톤 | 시점 | 작업 | 산출물 |
|----------|------|------|--------|
| **M0 파일럿** | 차주 | 현 Vite 스택 유지 + 목→실 API 교체 + 바른손카드 `TB_Lounge_*` 테이블 신설 + 발급/조회 연동 | 실서비스 오픈 |
| **M1 정렬 스프린트** | W1~W3 (2인 병렬) | 프론트→Next.js/Tailwind, 백엔드→NestJS/Prisma, MSSQL **어댑터 격리**, `domain.ts` 이관 | donald-duck 규격 도메인 |
| **M2 흡수** | W3+ (donald-duck 킥오프) | `voucher`·`settlement` 도메인 편입 | 통합 완료 |

### 11.1 기간 산정 (dev-days)
| 작업 | 1인 기준 |
|------|:--------:|
| 프론트: Next.js+Tailwind 스캐폴딩 + 10개 뷰 이식 + TanStack/Zustand 배선 | 11~13일 |
| 백엔드: NestJS 스캐폴드 + 인증·이용권·정산 도메인 + MSSQL 어댑터 | 12~18일 |
| 통합·QA·반응형 | 3~5일 |
| **합계** | **1인 ~5~6주 / 2인 병렬 ~3주** |

- `domain.ts`(순수 TS)는 프레임워크 무관 → **거의 그대로 이관**. 재작성 비용은 UI 계층·신규 백엔드에 집중.
- **권장:** 2인 3주 스프린트 → donald-duck 킥오프와 자연 동기화.

## 12. donald-duck 흡수 아키텍처 (신설)

donald-duck이 **미구현(3주 후 착수)** → 처음부터 도메인으로 함께 설계 가능(최적 타이밍).

### 12.1 편입 형태
| 신규 도메인 | 서비스 그룹 | 재사용 자산 |
|-------------|-------------|-------------|
| `voucher` (이용권 사용처리) | `commerce` 또는 신규 `social` | 인증(JWT), **Notification 엔진**(SMS), **Port&Adapter**(MSSQL) |
| `settlement` (사용 기준 정산) | 동일 | **StateMachine/Pricing 엔진**, EventBus |

### 12.2 ⚠️ 흡수 선결과제 — 정산 모델 이원화
- donald-duck 셀러 정산 = **오픈마켓 수수료형**(구매확정+7일, 월 2회, 8~12%). 근거 `donald-duck/files/09_seller_marketplace.md`.
- 바른라운지 = **사용 기준 정산**(사용분만 익월 25일 지급, 홀드백 없음, 다지점 사용처리 지점 귀속). **모델이 근본적으로 다름.**
- → donald-duck 정산 엔진이 **복수 정산 모델(settlement type)을 config로 지원**하도록 설계. donald-duck의 "비즈니스 규칙 = 데이터"(`system_configs` JSONB) 철학이 이를 지원 → **정산 유형을 데이터로 주입**. **donald-duck 킥오프 1순위 의제.**

### 12.3 설계 정합성
- 어드민의 `api.ts`/`auth.ts` **함수 시그니처 격리** = donald-duck "공유 API 추상화 계약"·"도메인 격리" 철학과 동일 → 흡수 마찰 최소.
- 바른손카드 MSSQL은 donald-duck의 MES/PG/PASS와 동일하게 **`CouponPort` + `BarunsonCardMssqlAdapter`**로 격리.

## 13. 바른손카드 DB 설계 — 소셜커머스 쿠폰 사용 (신설)

바른손카드가 이용권 발급·사용·정산 데이터의 **단일 진실원천**. 어드민에 **사용유무 데이터를 제공**하기 위한 스키마.

### 13.1 설계 원칙
1. **단일 진실원천 = 바른손카드.** 발급·상태·잔액 소유자는 본사, 어드민은 트리거+조회.
2. **사용 원장 append-only.** 사용/차감 1건 = 1로우. UPDATE/DELETE 금지(정산·감사 근거).
3. **원자적 상태전이 + 멱등성.** 두 지점 동시 처리 시 1건만 성공. `Idempotency-Key` 유니크 강제.
4. **정산 귀속 = 사용처리 지점**(구매 지점 아님). 지점→정산주체(payee) 매핑.
5. **PII 최소 노출.** 미사용 쿠폰 고객정보 비노출, 사용 시점 조회에만. API 레이어 마스킹.

### 13.2 위치 — 신규 DB `barunlounge` 권장
- 바른손카드는 이미 **버티컬별 DB 분리**(디지털=barunson / 실물=bar_shop1). 바른라운지는 신규 버티컬이고 기존 `TB_Coupon`(웨딩 할인쿠폰)과 **동음이의 충돌** → 신규 DB `barunlounge` 또는 최소 `TB_Lounge_*` 접두어 격리.
- 관례 준수: MSSQL, `TB_` 접두어, `dbo` 스키마, **FK 제약 없음(앱레벨 정합성)**, `datetime2`, varchar 코드.

### 13.3 테이블 (MSSQL DDL, `types.ts`와 1:1)
```sql
-- 업체
TB_Lounge_Vendor(Vendor_ID PK, Vendor_Code UQ, Vendor_Name, Biz_No,
  Access_Status /*NONE/PENDING/GRANTED*/, Regist_DateTime)

-- 지점(직영·가맹) — 정산 귀속 단위
TB_Lounge_Branch(Branch_ID PK, Vendor_ID, Branch_Code UQ, Branch_Name,
  Branch_Kind /*DIRECT/FRANCHISE*/, Payee_Name, Settle_Bank, Settle_Account, Settle_Holder)

-- 딜(판매 상품)
TB_Lounge_Deal(Deal_ID PK, Deal_Code, Vendor_ID, Voucher_Type /*SERVICE/AMOUNT/COUNT*/,
  Product_Name, Paid_Price /*정산기준*/, Origin_Price, Face_Value /*금액:액면 / 횟수:총회수*/,
  Valid_Months, Display_YN)

-- 발급 이용권(= Coupon) — 상태의 원천
TB_Lounge_Voucher(Voucher_ID PK, Voucher_Code UQ, Deal_ID, Order_ID,
  Cust_Name /*PII*/, Cust_Phone /*PII*/, Buy_DateTime, Expire_DateTime,
  Paid_Price /*발급 스냅샷*/, Face_Value, Used_Amount /*캐시*/,
  Status /*AVAILABLE/USED/REFUNDED*/, Buy_Branch_ID, Row_Ver rowversion, Regist_DateTime)
  -- IX(Deal_ID, Status), 연락처 끝4자리 검색용 정규화 컬럼+인덱스

-- 사용 원장(append-only) — 정산 근거
TB_Lounge_Voucher_Usage(Usage_ID PK bigint, Voucher_ID, Usage_Type /*REDEEM/DEDUCT*/,
  Usage_Amount /*금액:원 / 횟수:회 / 일반:판매가*/, Settle_Amount /*사용시점 확정 정산액*/,
  Branch_ID /*처리지점=정산귀속*/, Processed_By, Processed_DateTime,
  Idempotency_Key UQ /*중복차단*/, Sms_Sent_YN)
  -- IX(Processed_DateTime, Branch_ID)

-- 정산 집계(지급일 × 정산주체)
TB_Lounge_Settlement(Settlement_ID PK, Payee_Branch_ID, Usage_Month /*'2026-06'*/,
  Payout_Date /*익월 25일*/, Total_Settle, Usage_Count, Status /*PENDING/CONFIRMED/PAID*/)
```

### 13.4 데이터 흐름 (본사 ↔ 어드민)
```
① 구매(본사)  → TB_Lounge_Voucher INSERT (Status='AVAILABLE')
② 사용처리(어드민) → 본사 API 원자 처리:
     UPDATE TB_Lounge_Voucher SET Status='USED', Used_Amount+=@amt
       WHERE Voucher_ID=@id AND Status='AVAILABLE'   -- ★영향행 0이면 이미사용(409)
     + TB_Lounge_Voucher_Usage INSERT(Idempotency_Key)  -- 유니크가 재시도 흡수
③ 사용 이벤트 → SMS 발송 + 정산 라인 생성
④ 조회(어드민) → Usage/Settlement SELECT (PII 마스킹)
```
- **연동 방향(하이브리드):** 조회=Pull(`GET /vouchers`), 상태변경 알림=Push(웹훅 `voucher.redeemed`/`voucher.refunded`). **환불은 반드시 Push.**

### 13.5 동시성·정산 핵심
1. **중복 사용 차단:** `UPDATE ... WHERE Status='AVAILABLE'` 영향행 0 → 409. FK 부재 환경이라 **원자적 UPDATE + 멱등키 유니크**가 정합성 유일 방어선.
2. **정산액 스냅샷:** `Settle_Amount`를 사용 시점 확정 저장 → 판매가/수수료율 변경이 과거 정산에 영향 없음.
3. **잔액 = 원장 합계:** `Face_Value - SUM(Usage_Amount)`. `Used_Amount`는 성능 캐시, 진실은 원장.

## 14. 미해결 결정 (Open Questions)
1. **정산 지급 주체** — (A) 바른손카드 이체 대행 vs (B) 운영사 직접(펌뱅킹).
2. **정산 계산 주체** — 서버 계산(권장) vs 어드민. 수수료율(계약 제5조) 관리 위치.
3. **정산 연동 인터페이스** — REST / 배치(EDI·전문) / 공용 DB.
4. **결제 데이터 원본** — 주문·취소·환불 수신 구조 확정.
5. **인증 방식** — 본사 통합 계정(SSO/JWT) vs 파트너 전용. 직원 Google 로그인 유지 여부.
6. **알림** — SMS vs 카카오 알림톡, 발송 주체, 템플릿 사전승인.
7. **환불 이벤트 전달** — 웹훅 vs 폴링.
8. **`barunlounge` DB 신설 vs `TB_Lounge_*` 접두어** — 백업·모니터링·접속권한(조휘열 경유) 셋업 포함.
9. **M0 선행 의존성** — 본사 딜 판매·발급 흐름 준비 여부 (완전 연동 vs 수동주입 파일럿).

## 15. 참고 — 현행 구현 산출물
- 리포 루트 `index.html` + `src/*`, 데모 계정 `demo@barunn.net` / `barun@1234`(업체), 직원=Google 데모.
- 화면 스크린샷 `screenshots/*.png`.
