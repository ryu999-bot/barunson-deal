// ===== 도메인 타입 =====

export type CouponType = 'service' | 'amount' | 'count'; // 일반 쿠폰 | 자유이용권(금액형) | 다회권(횟수형)
export type CouponStatus = 'available' | 'used' | 'refunded';

// 지점 (다지점 브랜드 — 직영·가맹 혼재)
// 전 지점 동일 상품·동일가 전제. 쿠폰은 전 지점에서 사용 가능하며,
// 정산은 "사용처리한 지점"의 정산주체(payee)로 귀속된다.
export type BranchKind = 'direct' | 'franchise'; // 직영 | 가맹
export interface Branch {
  id: string;
  name: string;      // 지점명 (예: 강남점)
  kind: BranchKind;
  payee: string;     // 정산주체(사업자) — 직영은 본사로 합산, 가맹은 각자 계좌
  // 지점별 정산 방법(계좌) — 가맹=지점 계좌 / 직영·미입력=정산주체 계좌
  settleBank?: string;
  settleAccount?: string;
  settleHolder?: string;
}

export interface UsageEntry {
  date: string;      // 'YYYY-MM-DD HH:mm'
  amount: number;    // 차감량 — 금액형: 원 / 다회권: 회수
  branchId?: string; // 차감 처리한 지점 — 정산 귀속 기준
}

export interface Coupon {
  code: string;
  type: CouponType;
  product: string;
  name: string;
  phone: string;
  buyDate: string;   // 'YYYY-MM-DD'
  expire: string;    // 'YYYY-MM-DD'
  paid: number;      // 고객 결제가(판매가) — 정산 기준
  origin?: number;   // 일반 쿠폰·다회권 정상가(할인 전)
  face?: number;     // 금액형: 액면가(총 충전액) / 다회권: 총 회수
  used?: number;     // 금액형: 사용 금액 누계 / 다회권: 사용 회수 누계
  status: CouponStatus;
  usedAt?: string;
  usedBy?: string;
  branchId?: string;     // 구매 시 지정한 대표 지점 (사용은 전 지점 가능)
  usedBranchId?: string; // 일반 쿠폰 사용처리 지점 — 정산 귀속 기준
  history?: UsageEntry[];
}

export interface RegisterInput {
  type: CouponType;
  product: string;
  paid: number;
  face?: number;
  origin?: number;
  months: number;
  name: string;
  phone: string;
}

export interface InquiryInput {
  category: string;
  phone: string;
  subject: string;
  body: string;
}

// 발송된 알림 문자 이력
export interface SmsEntry {
  at: string;     // 'YYYY-MM-DD HH:mm'
  phone: string;
  message: string;
  kind: 'redeem' | 'deduct' | 'used-up';
}

// 운영사 공지사항
export interface Notice {
  id: number;
  title: string;
  date: string;
  body: string;
  pinned?: boolean;
}

// 운영 대시보드 — 업체별 집계 (바른손카드 직원용)
export interface OpsVendorStat {
  vendor: string;
  region: string;
  revenue: number; // 매출(결제액)
  issued: number;  // 발급 쿠폰 수
  used: number;    // 사용 쿠폰 수
  settle: number;  // 정산액(사용 기준 누계)
}

// 업체 정산/사업자 정보 (설정)
export interface VendorProfile {
  bank?: string;
  account?: string;
  holder?: string;
  company?: string;
  ceo?: string;
  addr?: string;
  bizType?: string;
  bizItem?: string;
  taxEmail?: string;
  phone?: string;
}
