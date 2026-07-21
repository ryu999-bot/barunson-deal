// ============================================================
//  데이터 연동 계층 — 바른손카드 PublicApi(LoungeController) 실연동 전용.
//  ──────────────────────────────────────────────────────────
//  운영 배포 준비: 목업(mock) 데이터/토글 제거. 모든 이용권·지점·사용처리·
//  차감·사용원장 조회는 PublicApi 를 직접 호출한다. 인증은 config 의
//  LOUNGE_CLIENT_SECRET(빌드 env 또는 localStorage 주입) → Partner/authenticate.
//
//  ⚠️ PublicApi 미제공 기능은 아래에서 비활성(빈 결과/no-op) 처리했다:
//     - 운영 대시보드 집계(getOpsStats)
//     - 공지사항(listNotices/addNotice/deleteNotice)
//     - 알림문자 이력(listSms) / 어드민 직접발송(sendSms — 서버 자동발송)
//   → 해당 백엔드 API 가 준비되면 이 부분을 실제 호출로 교체할 것.
// ============================================================
import type { Coupon, InquiryInput, SmsEntry, Notice, OpsVendorStat, Branch, BranchKind } from './types';
import { VENDOR, todayStr,
  API_BASE, LOUNGE_CLIENT_ID, LOUNGE_CLIENT_SECRET, PILOT_COMPANY_SEQ, PILOT_BRANCH_ID } from './config';

// ===== PublicApi 인증/호출 =====
let _clientToken: string | null = null;
let _scopeToken: string | null = null;
const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// ① 앱 클라이언트 토큰 (thelounge)
async function clientToken(): Promise<string> {
  if (_clientToken) return _clientToken;
  const r = await fetch(`${API_BASE}/Partner/authenticate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: LOUNGE_CLIENT_ID, clientSecret: LOUNGE_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error('AUTH_FAIL');
  _clientToken = (await r.json()).token;
  return _clientToken!;
}
// ② 스코프 토큰 (업체/지점) — 자체 로그인 후 발급. 파일럿은 config 값 사용.
async function scopeToken(): Promise<string> {
  if (_scopeToken) return _scopeToken;
  const r = await fetch(`${API_BASE}/Lounge/auth/scope`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await clientToken()}` },
    body: JSON.stringify({ companySeq: PILOT_COMPANY_SEQ, branchId: PILOT_BRANCH_ID, operatorId: VENDOR.name }),
  });
  if (!r.ok) throw new Error('SCOPE_FAIL');
  _scopeToken = (await r.json()).token;
  return _scopeToken!;
}
// 스코프 토큰 Bearer 부착 fetch
async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}), Authorization: `Bearer ${await scopeToken()}` },
  });
}
// LoungeVoucherInfo(API) → Coupon(앱)
function mapVoucher(v: any): Coupon {
  const type: Coupon['type'] = v.voucherType === 'AMOUNT' ? 'amount' : v.voucherType === 'COUNT' ? 'count' : 'service';
  return {
    code: v.code, type, product: v.dealName,
    name: v.custName || '', phone: v.custPhone || '',
    buyDate: v.buyDateTime ? String(v.buyDateTime).slice(0, 10) : '',
    expire: v.expireAt ? String(v.expireAt).slice(0, 10) : '',
    paid: v.paidPrice, face: v.faceValue ?? undefined, used: v.usedAmount,
    status: v.status === 'USED' ? 'used' : v.status === 'REFUNDED' ? 'refunded' : 'available',
    branchId: v.buyBranchId != null ? String(v.buyBranchId) : undefined,
    usedBranchId: v.status === 'USED' ? (v.buyBranchId != null ? String(v.buyBranchId) : undefined) : undefined,
  };
}
async function refetchCoupon(code: string): Promise<Coupon> {
  const r = await apiFetch(`/Lounge/vouchers/search?code=${encodeURIComponent(code)}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) throw new Error('NOT_FOUND');
  return mapVoucher(rows[0]);
}

// 사용/차감 원장 (GET /api/Lounge/usages 응답). 정산 화면·판매현황 사용 내역 데이터 소스.
export interface UsageRow {
  usageId: number;
  voucherCode: string;
  dealName: string;
  voucherType: string;      // 딜 유형 SERVICE / AMOUNT / COUNT
  usageType: 'REDEEM' | 'DEDUCT';
  usageAmount: number;      // 금액형=원 / 횟수형=회 / 일반형=판매가
  settleAmount: number;     // 사용 시점 확정 정산액(수수료 공제 전)
  branchId: number;
  branchName?: string;
  processedAt: string;
  custName?: string;        // 마스킹
}
export interface UsagePage {
  total: number;
  page: number;
  size: number;
  totalSettle: number;      // 기간 정산 예정 기준액
  totalUsage: number;
  items: UsageRow[];
}

export const api = {
  /**
   * 본사(COMPANY) 로그인 — 바른손웹 등록 제휴사 login_id/pw로 로그인.
   * PublicApi가 검증 후 그 CompanySeq로 스코프 토큰 발급 → 이후 /Lounge/* 호출에 사용.
   */
  async companyLogin(loginId: string, password: string): Promise<{ companySeq: number; companyName: string }> {
    const r = await fetch(`${API_BASE}/Lounge/company-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await clientToken()}` },
      body: JSON.stringify({ loginId, password }),
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'INVALID' : 'LOGIN_FAIL');
    const j = await r.json();
    _scopeToken = j.token;   // 본사 스코프 토큰 — 이후 apiFetch가 이 토큰 사용
    return { companySeq: j.companySeq, companyName: j.companyName };
  },

  /** 발급 쿠폰 전체 조회 — GET /Lounge/vouchers (업체 스코프, PII 마스킹) */
  async listCoupons(): Promise<Coupon[]> {
    const r = await apiFetch('/Lounge/vouchers?size=500');
    const j = await r.json();
    return (j.items || []).map(mapVoucher);
  },

  /** 지점 목록 조회 — GET /Lounge/branches */
  async listBranches(): Promise<Branch[]> {
    const r = await apiFetch('/Lounge/branches');
    const rows = await r.json();
    return (rows || []).map((b: any): Branch => ({
      id: String(b.branchId), name: b.branchName,
      kind: b.branchKind === 'FRANCHISE' ? 'franchise' : 'direct', payee: VENDOR.name,
      phone: b.phone, addr: b.addr,
      settleBank: b.settleBank, settleAccount: b.settleAccount, settleHolder: b.settleHolder,
    }));
  },

  /**
   * 지점 등록 — POST /Lounge/branches. 정산주체(payee)는 서버가 "토큰 스코프의 로그인 업체"로 자동 지정.
   * 정산계좌(settle*) = 지점별 정산 방법(가맹 개별정산용).
   */
  async addBranch(input: { name: string; kind: BranchKind; payee: string; phone?: string; addr?: string; settleBank?: string; settleAccount?: string; settleHolder?: string }): Promise<Branch> {
    const r = await apiFetch('/Lounge/branches', {
      method: 'POST',
      body: JSON.stringify({
        branchName: input.name, branchKind: input.kind === 'franchise' ? 'FRANCHISE' : 'DIRECT',
        branchPhone: input.phone, branchAddr: input.addr,
        settleBank: input.settleBank, settleAccount: input.settleAccount, settleHolder: input.settleHolder,
      }),
    });
    if (!r.ok) throw new Error('ADD_BRANCH_FAIL');
    const b = await r.json();
    return {
      id: String(b.branchId), name: b.branchName, kind: b.branchKind === 'FRANCHISE' ? 'franchise' : 'direct',
      payee: input.payee, phone: input.phone, addr: input.addr,
      settleBank: b.settleBank ?? input.settleBank, settleAccount: b.settleAccount ?? input.settleAccount, settleHolder: b.settleHolder ?? input.settleHolder,
    };
  },

  /** 일반 쿠폰 사용처리 — POST /Lounge/vouchers/{code}/redeem. branchId: 처리 지점(정산 귀속) */
  async redeem(code: string, branchId: string): Promise<Coupon> {
    const r = await apiFetch(`/Lounge/vouchers/${encodeURIComponent(code)}/redeem`, {
      method: 'POST', headers: { 'Idempotency-Key': uuid() }, body: JSON.stringify({ branchId: Number(branchId) }),
    });
    if (!r.ok) throw new Error(r.status === 409 ? 'ALREADY_USED' : r.status === 403 ? 'SCOPE' : 'REDEEM_FAIL');
    return refetchCoupon(code);
  },

  /** 자유이용권/다회권 차감 — POST /Lounge/vouchers/{code}/deduct. 금액형 amount=원, 횟수형 amount=회 */
  async deduct(code: string, amount: number, branchId: string): Promise<Coupon> {
    const r = await apiFetch(`/Lounge/vouchers/${encodeURIComponent(code)}/deduct`, {
      method: 'POST', headers: { 'Idempotency-Key': uuid() }, body: JSON.stringify({ branchId: Number(branchId), amount }),
    });
    if (!r.ok) throw new Error(r.status === 409 ? 'ALREADY_USED' : r.status === 422 ? 'OVER_BALANCE' : r.status === 403 ? 'SCOPE' : 'DEDUCT_FAIL');
    return refetchCoupon(code);
  },

  /**
   * 사용/차감 원장 조회 (기간별) — GET /Lounge/usages. 정산 화면·판매현황 사용 내역 데이터 소스.
   * 정산 예정액 = 응답 totalSettle (업체 스코프, 지점 계정은 자기 처리분 자동 필터).
   */
  async listUsages(opts: { from?: string; to?: string; branchId?: string; page?: number; size?: number } = {}): Promise<UsagePage> {
    const q = new URLSearchParams();
    if (opts.from) q.set('from', opts.from);
    if (opts.to) q.set('to', opts.to);
    if (opts.branchId) q.set('branchId', opts.branchId);
    q.set('page', String(opts.page ?? 1));
    q.set('size', String(opts.size ?? 200));
    const r = await apiFetch(`/Lounge/usages?${q.toString()}`);
    if (!r.ok) throw new Error(r.status === 403 ? 'SCOPE' : 'USAGES_FAIL');
    return await r.json();
  },

  /**
   * 1:1 문의 — mailto URL 생성(메일앱 연동). 서버 API 불필요.
   */
  async sendInquiry(input: InquiryInput): Promise<string> {
    const subject = `[바른라운지 업체문의/${input.category}] ${input.subject}`;
    const body =
      `■ 업체명: ${VENDOR.name}\n` +
      `■ 문의 유형: ${input.category}\n` +
      `■ 회신 연락처: ${input.phone || '(미입력)'}\n` +
      `■ 작성일: ${todayStr}\n` +
      `────────────────────────\n` +
      `${input.body}\n`;
    return `mailto:${VENDOR.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  },

  // ===== PublicApi 미제공 — 백엔드 연동 전까지 비활성 (목업 제거) =====

  /** 알림문자 발송 — 어드민 직접 발송 없음. 사용/차감 성공 시 서버(bar_shop1)가 자동 발송하므로 no-op. */
  async sendSms(_phone: string, _message: string, _kind: SmsEntry['kind'] = 'redeem'): Promise<void> {
    /* no-op: 서버 자동발송 */
  },

  /** 알림문자 발송 이력 — API 미제공(핸드오버 §6-4 회신대기). 연동 시 서버 조회로 교체. */
  async listSms(): Promise<SmsEntry[]> {
    return [];
  },

  /** 운영 대시보드(업체별 매출·정산 집계) — API 미제공. 연동 시 서버 집계로 교체. */
  async getOpsStats(): Promise<OpsVendorStat[]> {
    return [];
  },

  /** 운영사 공지사항 — API 미제공. 연동 시 서버 조회로 교체. */
  async listNotices(): Promise<Notice[]> {
    return [];
  },

  /** 공지 등록 — API 미제공. 백엔드 연동 전까지 비활성. */
  async addNotice(_input: { title: string; body: string; pinned?: boolean }): Promise<Notice> {
    throw new Error('공지 등록 API 미연동');
  },

  /** 공지 삭제 — API 미제공. 백엔드 연동 전까지 no-op. */
  async deleteNotice(_id: number): Promise<void> {
    /* no-op */
  },
};
