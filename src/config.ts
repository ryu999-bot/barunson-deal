// ===== 운영 설정 / 공통 유틸 =====
import type { Branch } from './types';

export const BRAND = '더마린클리닉';
export const VENDOR = { name: BRAND, email: 'jungmin.kim@barunn.net' };

// 지점 목록 (직영·가맹 혼재). 전 지점 동일 상품·동일가 → 쿠폰은 전 지점 사용 가능.
// 정산주체(payee): 직영점 사용분은 본사 계좌로 합산, 가맹점 사용분은 각 가맹점 계좌로 개별 지급.
export const BRANCHES: Branch[] = [
  { id: 'gangnam', name: '강남점', kind: 'direct', payee: '(주)더마린 본사' },
  { id: 'hongdae', name: '홍대점', kind: 'direct', payee: '(주)더마린 본사' },
  { id: 'bundang', name: '분당점', kind: 'franchise', payee: '더마린 분당점(가맹)', settleBank: '국민은행', settleAccount: '123401-04-567890', settleHolder: '더마린분당' },
  { id: 'seomyeon', name: '부산서면점', kind: 'franchise', payee: '더마린 부산서면점(가맹)', settleBank: '부산은행', settleAccount: '101-2202-3303-04', settleHolder: '더마린서면' },
];
export const branchOf = (id?: string): Branch => BRANCHES.find((b) => b.id === id) || BRANCHES[0];

// Google 로그인용 OAuth Client ID.
// Google Cloud Console > API 및 서비스 > 사용자 인증 정보에서 OAuth 2.0 클라이언트 ID를
// 발급받아 넣으세요. 승인된 자바스크립트 원본에 http://localhost:5173 (및 배포 도메인) 등록 필요.
// 비워두면 'Google로 계속하기'가 데모 계정으로 동작합니다.
export const GOOGLE_CLIENT_ID = '';

// ===== 바른손카드 PublicApi 연동 =====
// USE_API=true 면 목(mock) 대신 실제 PublicApi(LoungeController)를 호출한다.
// ⚠️ 순수 프론트엔드라 ClientSecret이 브라우저에 노출된다 → dev/데모 한정.
//    운영에서는 라운지 앱 백엔드가 thelounge 인증·스코프 토큰 발급을 대행해야 함(핸드오버 §1).
//
// [기본값: dev 실연동 ON] — dev PublicApi(dev DB) 를 기본으로 조회한다.
//   시크릿(LOUNGE_SECRET)은 보안상 소스에 커밋하지 않고 localStorage 로 주입한다.
//   브라우저 콘솔에서:
//     localStorage.setItem('LOUNGE_SECRET','<dev 시크릿>')   // thelounge ClientSecret (dev) — 실연동에 필수
//     localStorage.setItem('LOUNGE_COMPANY_SEQ','8433')     // (선택) 파일럿 업체, 기본 8433
//   목(mock) 데모 데이터로 되돌리려면: localStorage.setItem('LOUNGE_USE_API','false') 후 새로고침.
const ls = (k: string): string | null => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null);
export const USE_API = ls('LOUNGE_USE_API') !== 'false'; // 기본 true(dev 실연동). 'false' 로 명시하면 목(mock)
export const API_BASE = 'https://dev-api.barunsoncard.com/api'; // dev PublicApi (운영: https://api.barunsoncard.com/api)
export const LOUNGE_CLIENT_ID = 'thelounge';
export const LOUNGE_CLIENT_SECRET = ls('LOUNGE_SECRET') || ''; // localStorage 주입(미커밋) — 운영 프론트에 넣지 말 것
export const PILOT_COMPANY_SEQ = Number(ls('LOUNGE_COMPANY_SEQ')) || 8433; // 파일럿 업체(바른라운지 파일럿) COMPANY_SEQ
export const PILOT_BRANCH_ID: number | null = ls('LOUNGE_BRANCH_ID') ? Number(ls('LOUNGE_BRANCH_ID')) : null; // 지점 계정이면 지정

// 정산: 매월 1일~말일 사용분을 익월 PAYOUT_DAY일에 지급
export const PAYOUT_DAY = 25;

// 데모 기준일. 실제 연동 시 `new Date()`로 교체하세요.
export const BASE_DATE = new Date(2026, 5, 30); // 2026-06-30

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const todayStr = ymd(BASE_DATE);

export const won = (n: number) => (Math.round(n) || 0).toLocaleString('ko-KR');

// 처리 일시 스탬프 (날짜는 기준일, 시각은 실제 시각)
export const stamp = () => `${todayStr} ${new Date().toTimeString().slice(0, 5)}`;
