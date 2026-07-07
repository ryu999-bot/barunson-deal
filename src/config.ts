// ===== 운영 설정 / 공통 유틸 =====
import type { Branch } from './types';

export const BRAND = '더마린클리닉';
export const VENDOR = { name: BRAND, email: 'jungmin.kim@barunn.net' };

// 지점 목록 (직영·가맹 혼재). 전 지점 동일 상품·동일가 → 쿠폰은 전 지점 사용 가능.
// 정산주체(payee): 직영점 사용분은 본사 계좌로 합산, 가맹점 사용분은 각 가맹점 계좌로 개별 지급.
export const BRANCHES: Branch[] = [
  { id: 'gangnam', name: '강남점', kind: 'direct', payee: '(주)더마린 본사' },
  { id: 'hongdae', name: '홍대점', kind: 'direct', payee: '(주)더마린 본사' },
  { id: 'bundang', name: '분당점', kind: 'franchise', payee: '더마린 분당점(가맹)' },
  { id: 'seomyeon', name: '부산서면점', kind: 'franchise', payee: '더마린 부산서면점(가맹)' },
];
export const branchOf = (id?: string): Branch => BRANCHES.find((b) => b.id === id) || BRANCHES[0];

// Google 로그인용 OAuth Client ID.
// Google Cloud Console > API 및 서비스 > 사용자 인증 정보에서 OAuth 2.0 클라이언트 ID를
// 발급받아 넣으세요. 승인된 자바스크립트 원본에 http://localhost:5173 (및 배포 도메인) 등록 필요.
// 비워두면 'Google로 계속하기'가 데모 계정으로 동작합니다.
export const GOOGLE_CLIENT_ID = '';

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
