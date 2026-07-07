# 바른라운지 업체 관리자 (바른손카드)

업체용 정산·운영 콘솔. 회원가입·로그인(Google 포함) / 업체 권한 요청 / 판매현황 / 쿠폰 사용처리(금액형 차감) / 쿠폰 등록 / 정산 관리(70·30 풀 홀드백) / 1:1 문의 / 약관·정산 안내.

## 회원가입 / 로그인 / 업체 권한

- 이메일 **회원가입·로그인** 또는 **Google 로그인**(아래 설정) 지원. 세션은 브라우저에 유지됩니다.
- 가입 직후엔 **권한 없음** 상태 → 메뉴 **업체 권한**에서 사업자 정보를 제출하면 **승인 대기** → 바른손카드 승인 시 **연동 완료**. 그때부터 판매현황·쿠폰·정산 메뉴가 열립니다. (데모에서는 '데모: 권한 승인' 버튼으로 시뮬레이션)

### Google 로그인 설정

`src/config.ts`의 `GOOGLE_CLIENT_ID`에 Google Cloud OAuth 2.0 클라이언트 ID를 넣으세요.
[Google Cloud Console](https://console.cloud.google.com/) → API 및 서비스 → 사용자 인증 정보에서 발급하고, **승인된 자바스크립트 원본**에 `http://localhost:5173`(및 배포 도메인)을 등록합니다. 비워두면 'Google로 계속하기'가 **데모 계정**으로 동작합니다.

## 실행

```bash
npm install        # 최초 1회
npm run dev        # 로컬 개발 서버 (http://localhost:5173, 저장 시 실시간 반영)
npm run build      # 배포용 정적 번들 → dist/
npm run preview    # 빌드 결과 미리보기
npm run typecheck  # 타입 검사
```

로그인은 데모 단계라 아무 값이나 입력하면 됩니다.

## 구조

| 파일 | 역할 |
|------|------|
| `index.html` | 화면 마크업 |
| `src/style.css` | 디자인 시스템(quiet-luxury) |
| `src/types.ts` | 도메인 타입 (Coupon 등) |
| `src/config.ts` | 운영 설정(VENDOR·유보율·기준일)·공통 유틸 |
| `src/domain.ts` | 순수 로직 — 잔액·상태·환불·정산(70/30) 계산 |
| `src/api.ts` | **데이터 연동 계층** — 지금은 목 데이터, 연동 시 `fetch`로 교체 |
| `src/main.ts` | UI 렌더링·이벤트 |

## 바른손카드 사이트 연동

`src/api.ts`의 함수 내부만 실제 API 호출로 바꾸면 됩니다 (시그니처 유지).

```ts
async listCoupons() { return (await fetch('/api/coupons')).json(); }
async redeem(code)  { await fetch(`/api/coupons/${code}/redeem`, { method:'POST' }); ... }
async deduct(code, amount) { await fetch(`/api/coupons/${code}/deduct`, { method:'POST', body: JSON.stringify({ amount }) }); ... }
async register(input) { return (await fetch('/api/coupons', { method:'POST', body: JSON.stringify(input) })).json(); }
async sendInquiry(input) { await fetch('/api/inquiries', { method:'POST', body: JSON.stringify(input) }); }
```

기준일은 `src/config.ts`의 `BASE_DATE`를 `new Date()`로 바꾸면 실시간 기준으로 동작합니다.

## 정산 모델 (70/30 풀 홀드백)

- 정산 기준 = 고객 **결제가(판매가)**. 액면가/정상가는 표시용.
- **1차 70%**: 판매 익월 15일 지급.
- **2차 30%**: 유효기간 종료 익월 15일에 환불을 상계해 지급. 유보 30%는 환불 충당 → 역정산 없음.
- 유보 풀은 업체 전체 기간으로 합산 운영(쿠폰별 환불이 30%를 넘어도 다른 유보분으로 상계).
- 자유이용권 미사용 잔액 = 결제액 비례 90% 환불 대상.
