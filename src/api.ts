// ============================================================
//  데이터 연동 계층 (Integration seam)
//  ──────────────────────────────────────────────────────────
//  지금은 메모리 목(mock) 데이터로 동작합니다.
//  바른손카드 정식 사이트와 연동할 때는 각 함수 내부의
//  목 처리 부분을 fetch('/api/...') 호출로 바꾸기만 하면 됩니다.
//  (함수 시그니처/반환 타입은 그대로 유지)
//
//  [2026-07-13 신설 API — 정산·사용 내역 데이터 소스]
//  GET /api/Lounge/usages?from&to&branchId&page&size
//   · 기간별 사용/차감 원장. 응답: usageId, voucherCode, dealName,
//     usageType(REDEEM/DEDUCT), usageAmount, settleAmount(사용 시점 확정 정산액),
//     branchId/branchName, processedAt, custName(마스킹)
//     + 집계 total / totalSettle(기간 정산 예정 기준액) / totalUsage
//   · 스코프: 토큰 업체 기준(지점 계정은 자기 처리분 자동 필터)
//   → USE_API 연동 시 정산 화면·판매현황 사용 내역의 클라 계산
//     (domain.settleLines)을 이 API 조회로 대체할 것.
// ============================================================
import type { Coupon, InquiryInput, SmsEntry, Notice, OpsVendorStat, Branch, BranchKind } from './types';
import { VENDOR, BRAND, BRANCHES, branchOf, todayStr, stamp,
  USE_API, API_BASE, LOUNGE_CLIENT_ID, LOUNGE_CLIENT_SECRET, PILOT_COMPANY_SEQ, PILOT_BRANCH_ID } from './config';
import { balanceOf } from './domain';

// 지점 표기: '더마린클리닉 강남점'
const branchName = (id?: string) => `${BRAND} ${branchOf(id).name}`;

// 쿠폰은 구매 시 지점(branchId)이 지정되며, 그 지점을 운영하는 "사업자(정산주체)"의 지점에서만 사용 가능.
// 직영 계열(본사 사업자)은 직영 지점 간 교차 사용 가능, 가맹점 쿠폰은 해당 가맹점에서만 사용.
// 사용처리·차감 시 처리 지점이 기록되고(usedBranchId / history[].branchId) 정산은 그 지점에 귀속.
let COUPONS: Coupon[] = [
  // 일반 쿠폰 (단일 상품 · 1회 사용)
  { code: 'GL26-8842-1097', type: 'service', product: '물광 스킨부스터 + 진정 관리 5회 패키지', name: '김서연', phone: '010-2941-3380', buyDate: '2026-05-20', expire: '2026-08-18', origin: 450000, paid: 219000, status: 'available', branchId: 'gangnam' },
  { code: 'GL26-3098-2256', type: 'service', product: '딥클렌징 + 모공 타이트닝 관리 3회', name: '이도윤', phone: '010-3320-9981', buyDate: '2026-05-11', expire: '2026-07-05', origin: 240000, paid: 109000, status: 'available', branchId: 'hongdae' },
  { code: 'GL26-7740-1521', type: 'service', product: '프리미엄 뿌리염색 + 헤어 클리닉', name: '장유나', phone: '010-4471-2093', buyDate: '2026-06-12', expire: '2026-08-11', origin: 100000, paid: 30000, status: 'available', branchId: 'bundang' },
  { code: 'GL26-1182-9930', type: 'service', product: '프리미엄 클리닉 펌 + 트리트먼트', name: '정하늘', phone: '010-5567-2218', buyDate: '2026-05-30', expire: '2026-08-28', origin: 180000, paid: 89000, status: 'used', usedAt: '2026-06-29 19:42', branchId: 'gangnam', usedBranchId: 'gangnam', usedBy: '더마린클리닉 강남점' },
  // 가맹점(부산서면점)에서 사용처리된 건 — 정산은 가맹점 계좌로
  { code: 'GL26-4417-8820', type: 'service', product: '슈링크 리프팅 300샷 (탄력·윤곽)', name: '오세훈', phone: '010-3344-7790', buyDate: '2026-05-15', expire: '2026-07-23', origin: 150000, paid: 59000, status: 'used', usedAt: '2026-06-26 13:10', branchId: 'seomyeon', usedBranchId: 'seomyeon', usedBy: '더마린클리닉 부산서면점' },
  // 자유이용권 (금액형) — 강남점 구매분을 홍대점(같은 본사 직영)에서도 차감한 교차 사용 사례 포함
  { code: 'GL26-2200-0001', type: 'amount', product: '스킨케어 자유이용권 (100만원권)', name: '박지훈', phone: '010-7782-1145', buyDate: '2026-05-01', expire: '2026-08-01', paid: 200000, face: 1000000, used: 300000, status: 'available', branchId: 'gangnam', history: [{ date: '2026-05-12 14:20', amount: 200000, branchId: 'gangnam' }, { date: '2026-06-18 11:05', amount: 100000, branchId: 'hongdae' }] },
  { code: 'GL26-2200-0002', type: 'amount', product: '프리미엄 자유이용권 (50만원권)', name: '최민지', phone: '010-2941-6620', buyDate: '2026-03-01', expire: '2026-06-01', paid: 120000, face: 500000, used: 300000, status: 'available', branchId: 'hongdae', history: [{ date: '2026-03-20 16:40', amount: 300000, branchId: 'hongdae' }] },
  { code: 'GL26-2200-0003', type: 'amount', product: '바디·스파 자유이용권 (100만원권)', name: '한지우', phone: '010-8810-4456', buyDate: '2026-06-10', expire: '2026-09-10', paid: 200000, face: 1000000, used: 0, status: 'available', branchId: 'bundang', history: [] },
  { code: 'GL26-2200-0004', type: 'amount', product: '스킨케어 자유이용권 (100만원권)', name: '김도연', phone: '010-9921-5508', buyDate: '2026-04-20', expire: '2026-07-20', paid: 200000, face: 1000000, used: 1000000, status: 'used', usedAt: '2026-06-20 15:30', branchId: 'gangnam', usedBranchId: 'hongdae', usedBy: '더마린클리닉 홍대점', history: [{ date: '2026-05-02 13:00', amount: 500000, branchId: 'gangnam' }, { date: '2026-06-20 15:30', amount: 500000, branchId: 'hongdae' }] },
  // 다회권 (횟수형) — face=총 회수, used=사용 회수. 정산 = 회당 균등 단가(결제액÷총회수) × 사용 회수
  { code: 'GL26-3300-0001', type: 'count', product: '아쿠아필 딥클렌징 10회권', name: '윤소라', phone: '010-6642-7789', buyDate: '2026-05-05', expire: '2026-11-05', origin: 500000, paid: 300000, face: 10, used: 3, status: 'available', branchId: 'gangnam', history: [{ date: '2026-05-15 15:00', amount: 2, branchId: 'gangnam' }, { date: '2026-06-21 12:30', amount: 1, branchId: 'hongdae' }] },
  { code: 'GL26-3300-0002', type: 'count', product: '두피 스케일링 3회권', name: '서지안', phone: '010-2210-9934', buyDate: '2026-05-10', expire: '2026-08-10', origin: 150000, paid: 100000, face: 3, used: 2, status: 'available', branchId: 'hongdae', history: [{ date: '2026-05-22 11:00', amount: 1, branchId: 'hongdae' }, { date: '2026-06-14 17:20', amount: 1, branchId: 'hongdae' }] },
];

// 발송된 알림 문자 이력 (연동 시 서버 조회로 교체)
const SMS_LOG: SmsEntry[] = [
  { at: '2026-06-29 19:42', phone: '010-5567-2218', message: "[바른라운지] 정하늘님, '프리미엄 클리닉 펌 + 트리트먼트' 쿠폰이 정상 사용처리되었습니다. 이용해 주셔서 감사합니다. - 더마린클리닉 강남점", kind: 'redeem' },
  { at: '2026-06-18 11:05', phone: '010-7782-1145', message: "[바른라운지] 박지훈님, '스킨케어 자유이용권 (100만원권)' 100,000원 사용. 남은 잔액 700,000원. - 더마린클리닉 홍대점", kind: 'deduct' },
];

// 운영사 공지사항 — 직원이 등록/삭제 (연동 시 서버 API로 교체)
const NOTICE_KEY = 'glowdeal_notices';
const NOTICE_SEED: Notice[] = [
  { id: 3, title: '7월 정산 지급 안내 (7/25 예정)', date: '2026-06-25', body: '6월 사용(사용처리·차감)분에 대한 정산이 7월 25일에 정산주체별 등록 계좌로 지급됩니다. 정산 계좌가 등록되지 않은 업체는 [업체·정산 정보]에서 계좌를 먼저 등록해 주세요.', pinned: true },
  { id: 2, title: '사업자등록증·정산 계좌 등록 필수 안내', date: '2026-06-20', body: '원활한 정산을 위해 [업체·정산 정보] 메뉴에서 정산 계좌와 세금계산서 정보를 등록해 주세요. 미등록 시 정산 지급이 지연될 수 있습니다.' },
  { id: 1, title: '쿠폰 사용처리 시 고객 알림 문자 자동 발송', date: '2026-06-15', body: '이제 쿠폰 사용처리·자유이용권 차감이 완료되면 고객 연락처로 알림 문자가 자동 발송됩니다. 발송 내역은 [알림 문자 이력]에서 확인할 수 있습니다.' },
];
function loadNotices(): Notice[] {
  try {
    const r = JSON.parse(localStorage.getItem(NOTICE_KEY) || 'null');
    if (Array.isArray(r)) return r;
  } catch { /* ignore */ }
  localStorage.setItem(NOTICE_KEY, JSON.stringify(NOTICE_SEED));
  return NOTICE_SEED.slice();
}
function saveNotices(list: Notice[]) { localStorage.setItem(NOTICE_KEY, JSON.stringify(list)); }
function sortNotices(list: Notice[]): Notice[] {
  return list.slice().sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (a.date < b.date ? 1 : -1));
}

// 운영 대시보드 집계 (바른손카드 전체 · 연동 시 서버 집계로 교체)
const OPS: OpsVendorStat[] = [
  { vendor: '라움의원', region: '서울 강남', revenue: 4720000, issued: 80, used: 61, settle: 3599000 },
  { vendor: '바디라인의원', region: '서울 강남', revenue: 3120000, issued: 8, used: 5, settle: 1950000 },
  { vendor: '스킨랩서울', region: '서울 강남', revenue: 2180000, issued: 20, used: 14, settle: 1526000 },
  { vendor: '살롱드무드', region: '서울 강남', revenue: 1602000, issued: 18, used: 12, settle: 1068000 },
  { vendor: '더마린클리닉 (직영 2·가맹 2)', region: '서울·경기·부산', revenue: 1196000, issued: 9, used: 5, settle: 480000 },
  { vendor: '헤어테라피', region: '서울 마포', revenue: 780000, issued: 20, used: 17, settle: 663000 },
];

// 네트워크 호출 흉내 (연동 시 제거)
const delay = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

// ===== PublicApi 인증/호출 (USE_API=true 일 때만) =====
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

export const api = {
  /** 발급 쿠폰 전체 조회 */
  async listCoupons(): Promise<Coupon[]> {
    if (USE_API) {
      // 발급내역 목록 GET /api/Lounge/vouchers (업체 스코프, PII 마스킹)
      const r = await apiFetch('/Lounge/vouchers?size=500');
      const j = await r.json();
      return (j.items || []).map(mapVoucher);
    }
    await delay();
    return COUPONS.slice();
  },

  /** 지점 목록 조회 */
  async listBranches(): Promise<Branch[]> {
    if (USE_API) {
      const r = await apiFetch('/Lounge/branches');
      const rows = await r.json();
      return (rows || []).map((b: any): Branch => ({
        id: String(b.branchId), name: b.branchName,
        kind: b.branchKind === 'FRANCHISE' ? 'franchise' : 'direct', payee: VENDOR.name,
        phone: b.phone, addr: b.addr,
        settleBank: b.settleBank, settleAccount: b.settleAccount, settleHolder: b.settleHolder,
      }));
    }
    await delay();
    return BRANCHES.slice();
  },

  /**
   * 지점 등록 — 정산주체(payee)는 서버가 "토큰 스코프의 로그인 업체"로 자동 지정(핸드오버 §2.1).
   * 목에서는 호출부가 로그인 계정의 사업자명(payee)을 넘겨 같은 규칙을 재현한다.
   * 정산계좌(settle*) = 지점별 정산 방법(가맹 개별정산용).
   */
  async addBranch(input: { name: string; kind: BranchKind; payee: string; phone?: string; addr?: string; settleBank?: string; settleAccount?: string; settleHolder?: string }): Promise<Branch> {
    if (USE_API) {
      // POST /api/Lounge/branches → {branchId}. 정산주체=토큰 스코프 업체 자동. 정산계좌는 그대로 저장.
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
      const branch: Branch = {
        id: String(b.branchId), name: b.branchName, kind: b.branchKind === 'FRANCHISE' ? 'franchise' : 'direct',
        payee: input.payee, phone: input.phone, addr: input.addr,
        settleBank: b.settleBank ?? input.settleBank, settleAccount: b.settleAccount ?? input.settleAccount, settleHolder: b.settleHolder ?? input.settleHolder,
      };
      BRANCHES.push(branch);
      return branch;
    }
    await delay();
    const id = (input.name.replace(/\s+/g, '') || 'br') + '-' + Date.now().toString(36);
    const branch: Branch = {
      id, name: input.name, kind: input.kind, payee: input.payee, phone: input.phone, addr: input.addr,
      settleBank: input.settleBank, settleAccount: input.settleAccount, settleHolder: input.settleHolder,
    };
    BRANCHES.push(branch);
    return branch;
  },

  /** 일반 쿠폰 사용처리 — branchId: 처리 지점(정산 귀속) */
  async redeem(code: string, branchId: string): Promise<Coupon> {
    if (USE_API) {
      const r = await apiFetch(`/Lounge/vouchers/${encodeURIComponent(code)}/redeem`, {
        method: 'POST', headers: { 'Idempotency-Key': uuid() }, body: JSON.stringify({ branchId: Number(branchId) }),
      });
      if (!r.ok) throw new Error(r.status === 409 ? 'ALREADY_USED' : r.status === 403 ? 'SCOPE' : 'REDEEM_FAIL');
      return refetchCoupon(code);
    }
    await delay();
    const c = COUPONS.find((x) => x.code === code);
    if (!c) throw new Error('NOT_FOUND');
    c.status = 'used';
    c.usedAt = stamp();
    c.usedBranchId = branchId;
    c.usedBy = branchName(branchId);
    // 연동(확정): POST /api/Lounge/vouchers/{code}/redeem  body {branchId}
    //   헤더 Idempotency-Key(UUID) 필수. 409=이미 사용, 403=타 업체 스코프. 응답 {usageId, status}
    return c;
  },

  /** 자유이용권 금액 차감 — branchId: 처리 지점(정산 귀속) */
  async deduct(code: string, amount: number, branchId: string): Promise<Coupon> {
    if (USE_API) {
      const r = await apiFetch(`/Lounge/vouchers/${encodeURIComponent(code)}/deduct`, {
        method: 'POST', headers: { 'Idempotency-Key': uuid() }, body: JSON.stringify({ branchId: Number(branchId), amount }),
      });
      if (!r.ok) throw new Error(r.status === 409 ? 'ALREADY_USED' : r.status === 422 ? 'OVER_BALANCE' : r.status === 403 ? 'SCOPE' : 'DEDUCT_FAIL');
      return refetchCoupon(code);
    }
    await delay();
    const c = COUPONS.find((x) => x.code === code);
    if (!c) throw new Error('NOT_FOUND');
    c.used = (c.used || 0) + amount;
    (c.history = c.history || []).push({ date: stamp(), amount, branchId });
    if (balanceOf(c) <= 0) {
      c.status = 'used';
      c.usedAt = stamp();
      c.usedBranchId = branchId;
      c.usedBy = branchName(branchId);
    }
    // 연동(확정): POST /api/Lounge/vouchers/{code}/deduct  body {branchId, amount}
    //   금액형 amount=원, 횟수형 amount=회. Idempotency-Key 필수. 422=잔여 초과. 응답 {usageId, balance, status}
    return c;
  },

  /**
   * 1:1 문의 — 현재는 mailto URL을 만들어 반환(메일앱 연동).
   * 연동 시: await fetch('/api/inquiries', { method:'POST', body: JSON.stringify(input) }) 로 교체.
   */
  /**
   * 고객 알림 문자(SMS) 발송 — 현재는 목(콘솔 기록).
   * 연동 시: await fetch('/api/sms', { method:'POST', body: JSON.stringify({ phone, message }) })
   *          또는 알리고 / NHN Cloud / Twilio 등 SMS 게이트웨이 호출로 교체.
   */
  async sendSms(phone: string, message: string, kind: SmsEntry['kind'] = 'redeem'): Promise<void> {
    await delay();
    console.log(`[SMS] → ${phone}\n${message}`);
    SMS_LOG.unshift({ at: stamp(), phone, message, kind });
    // 연동(확정): 어드민 직접 발송 없음 — 사용/차감 성공 시 bar_shop1 서버가 자동 발송.
    //   연동 시 이 함수 호출 제거(또는 no-op). 발송 이력 API는 미제공 — 연동_명세 §6-4 회신 대기.
  },

  /** 알림 문자 발송 이력 (최신순) */
  async listSms(): Promise<SmsEntry[]> {
    await delay();
    return SMS_LOG.slice();
  },

  /** 운영 대시보드 — 업체별 매출·사용률·정산 집계 */
  async getOpsStats(): Promise<OpsVendorStat[]> {
    await delay();
    return OPS.slice();
  },

  /** 운영사 공지사항 (상단고정·최신순) */
  async listNotices(): Promise<Notice[]> {
    await delay();
    return sortNotices(loadNotices());
  },

  /** 직원: 공지 등록 */
  async addNotice(input: { title: string; body: string; pinned?: boolean }): Promise<Notice> {
    await delay();
    const list = loadNotices();
    const id = list.reduce((m, n) => Math.max(m, n.id), 0) + 1;
    const notice: Notice = { id, title: input.title, body: input.body, date: todayStr, pinned: !!input.pinned };
    list.unshift(notice);
    saveNotices(list);
    return notice;
  },

  /** 직원: 공지 삭제 */
  async deleteNotice(id: number): Promise<void> {
    await delay();
    saveNotices(loadNotices().filter((n) => n.id !== id));
  },

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
};
