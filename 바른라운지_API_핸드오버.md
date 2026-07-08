# 바른라운지 API 핸드오버 (라운지 어드민 개발자용)

- **대상**: 바른라운지 파트너 어드민 앱 개발자
- **제공자**: 바른손카드 (bar_shop1 / PublicApi)
- **기준일**: 2026-07-08
- **범위**: 라운지 어드민이 호출하는 API 2묶음 — **① 지점 등록/조회, ② 쿠폰 사용처리**
- **미제공**: 제휴사(업체) 등록·이용권(딜) 등록 = 바른손카드 통합관리자, 정산 = 바른 ERP(erp-backend) — 라운지 API 아님

---

## 1. 접속 · 인증

- **Base URL**: PublicApi 호스트 (예: `https://.../api`)
- **클라이언트**: `thelounge` (ClientId/Secret 별도 전달) — 앱 1개당 1클라이언트
- **스코프**: 발급 토큰은 파일럿 업체(정산주체 COMPANY)에 매핑됨. 지점·쿠폰 조회/처리는 이 스코프 내로 서버가 강제.

### 1.1 토큰 발급
```
POST /api/Partner/authenticate
Body: { "clientId": "thelounge", "clientSecret": "***" }
200 → { "token": "...", "refreshToken": "...", "expires": "...", "refreshTokenExpires": "..." }
```
- 이후 모든 호출: `Authorization: Bearer {token}`
- 만료 시 `POST /api/Partner/refresh-token { clientId, refreshToken }`

---

## 2. 지점 등록/조회 API

매장(지점) 마스터를 라운지 어드민에서 등록·관리. 등록 지점은 사용처리 시 "처리 지점"으로 선택됨(정산 귀속 단위).

### 2.1 지점 등록
```
POST /api/Lounge/branches
Body: {
  "branchName": "강남점",
  "branchKind": "DIRECT",        // DIRECT(직영) | FRANCHISE(가맹)
  "branchPhone": "02-000-0000",  // optional
  "branchAddr": "서울 강남구 ..." // optional
}
200 → { "branchId": 12 }
```
- 정산주체(Payee)는 토큰 스코프의 업체로 서버가 자동 설정.

### 2.2 지점 목록
```
GET /api/Lounge/branches
200 → [ { "branchId":12, "branchName":"강남점", "branchKind":"DIRECT",
          "phone":"02-...", "addr":"...", "useYN":"Y" }, ... ]
```

### 2.3 지점 수정 / 사용중지
```
PUT    /api/Lounge/branches/{branchId}   Body: { branchName, branchKind, branchPhone, branchAddr, useYN }
```

---

## 3. 쿠폰 사용처리 API

### 3.1 쿠폰 조회
```
GET /api/Lounge/vouchers/search?code={쿠폰번호}
GET /api/Lounge/vouchers/search?phone4={연락처끝4자리}
GET /api/Lounge/vouchers/search?name={고객명}
200 → [ {
  "code": "L2026....",
  "dealName": "필러 1회 이용권",
  "voucherType": "SERVICE",     // SERVICE(일반) | AMOUNT(금액) | COUNT(횟수)
  "status": "AVAILABLE",        // AVAILABLE | USED | REFUNDED
  "faceValue": 1000000,          // 금액형=액면 / 횟수형=총회수 / 일반형=null
  "usedAmount": 0,               // 누적 사용액/사용회수
  "balance": 1000000,            // 잔여(금액/회수), 일반형=null
  "paidPrice": 200000,
  "expireAt": "2027-01-07",
  "custName": "홍*동",           // PII 마스킹
  "custPhone": "010-****-5678"
} ]
```
- **PII 정책**: 미사용 쿠폰의 고객정보는 마스킹. 사용 시점(제시·조회) 외 원문 미노출.
- 타 업체(스코프 밖) 쿠폰은 검색되지 않음.

### 3.2 사용처리 (일반형)
```
POST /api/Lounge/vouchers/{code}/redeem
Header: Idempotency-Key: {UUID}       // 필수 — 중복요청 방지
Body:   { "branchId": 12 }            // 처리 지점
200 → { "usageId": 3345, "status": "USED" }
```

### 3.3 차감 (금액형/횟수형)
```
POST /api/Lounge/vouchers/{code}/deduct
Header: Idempotency-Key: {UUID}       // 필수
Body:   { "branchId": 12, "amount": 300000 }
        // 금액형 amount = 차감 금액(원) / 횟수형 amount = 사용 회수(회)
200 → { "usageId": 3346, "balance": 700000, "status": "AVAILABLE" }
       // 잔여 0이면 status = "USED"
```

### 3.4 응답 코드
| 코드 | 의미 |
|------|------|
| 200 | 성공 |
| 400 | 잘못된 요청(파라미터) |
| 401 | 인증 실패/토큰 만료 |
| 403 | 스코프 위반(타 업체 쿠폰) |
| 404 | 쿠폰 없음 |
| 409 | 이미 사용/환불됨(중복 사용 차단) |
| 422 | 잔여 초과(차감액/회수 > 잔여) |

- **동시성**: 두 지점이 같은 쿠폰을 동시에 처리해도 **1건만 성공**(서버 원자 처리 + 멱등키). 재시도는 같은 `Idempotency-Key`로 안전.
- 사용/차감 성공 시 고객에게 알림 문자 발송(서버).

---

## 4. 참고 (라운지 어드민이 하지 않는 것 = 바른손카드 통합관리자 담당)

- **제휴사(업체) 등록** = 통합관리자 기존 제휴사관리에서 등록(정산주체 COMPANY).
- **이용권(딜) 등록** = 통합관리자에서 상품등록과 함께 처리.
- **정산** = 바른 ERP(erp-backend)에서 처리(월 사용분 → 익월 25일 지급·세금계산서·회계). bar_shop1 사용원장을 ERP가 연동받음.
- **로그인 계정 관리** = 라운지 어드민 자체(업체/직원 로그인). bar API는 위 사용처리·지점만.
