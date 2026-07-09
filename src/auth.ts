// ============================================================
//  인증 / 계정 계층 (Auth seam)
//  ──────────────────────────────────────────────────────────
//  지금은 브라우저 localStorage 기반 목(mock)입니다.
//  ⚠ 비밀번호를 평문 저장하므로 데모 전용입니다.
//
//  계정 정책 (2026-07-09 개정): 사업자(정산주체) 단위 "회원가입 + 직원 승인제".
//   - 업체가 사업자 정보(사업자명·번호·등록증)로 가입 → 승인 대기(approved=false)
//   - 바른손카드 직원이 직원 콘솔에서 승인하면 전 메뉴 사용 가능
//   - 직원이 직접 발급(issueAccount)하는 경로도 병행 (즉시 사용)
//  계정에는 지점 스코프가 묶임: 발급 시 branchIds + 지점 관리(F-13)에서
//  등록한 자기 사업자(payee=vendorName) 지점. 처리 지점·정산 조회 범위가 계정으로 결정.
//
//  바른손카드 백엔드 연동 시:
//   - login → POST /api/auth/login (세션/JWT 쿠키)
//   - issueAccount → POST /api/partner-accounts (직원 콘솔)
//   - loginWithGoogle → 서버가 Google ID 토큰 검증 (직원)
//  함수 시그니처는 그대로 두고 내부만 교체하면 됩니다.
// ============================================================
import type { VendorProfile } from './types';

export type Provider = 'email' | 'google';
export type Role = 'vendor' | 'staff'; // 업체(사업자) | 바른손카드 내부 직원

export interface User {
  email: string;
  name: string;          // 담당자명
  provider: Provider;
  role: Role;
  pw?: string;           // 데모 전용(평문). 연동 시 제거.
  phone?: string;
  bizNo?: string;
  certName?: string;     // 사업자등록증 첨부 파일명(실제 파일은 서버 업로드)
  vendorName?: string;   // 사업자명(정산주체) — 예: (주)더마린 본사 / 더마린 분당점(가맹)
  branchIds?: string[];  // 이 계정이 운영하는 지점 스코프 (vendor 전용)
  issuedAt?: string;     // 계정 발급/가입일
  // 가입 승인 상태 — false=승인 대기(메뉴 잠금). undefined는 직원 발급 계정(즉시 사용)으로 간주.
  approved?: boolean;
  profile?: VendorProfile;
}

export interface IssueInput {
  email: string;
  name: string;        // 담당자명
  pw: string;          // 초기 비밀번호
  vendorName: string;  // 사업자명
  bizNo?: string;
  branchIds: string[];
}

/** 사업자 단위 회원가입 입력 — 가입 후 바른손카드 직원 승인 시 사용 가능 */
export interface SignupInput {
  email: string;
  name: string;        // 담당자명
  pw: string;
  vendorName: string;  // 사업자명(정산주체)
  bizNo: string;
  phone: string;
  certName: string;    // 사업자등록증 파일명
}

const USERS_KEY = 'glowdeal_users_v2'; // v2: 발급제 전환 (구 가입제 데이터와 분리)
const SESSION_KEY = 'glowdeal_session_v2';

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function save(key: string, val: unknown) { localStorage.setItem(key, JSON.stringify(val)); }

function getUsers(): Record<string, User> { return load<Record<string, User>>(USERS_KEY, {}); }
function setUsers(u: Record<string, User>) { save(USERS_KEY, u); }
const norm = (e: string) => e.trim().toLowerCase();
const delay = (ms = 50) => new Promise<void>((r) => setTimeout(r, ms));

// 데모 시드: 바른손카드가 발급해 준 사업자 계정 2종. 백엔드 연동 시 제거.
(function seedDemo() {
  const users = getUsers();
  let dirty = false;
  if (!users['demo@barunn.net']) {
    users['demo@barunn.net'] = {
      email: 'demo@barunn.net', name: '김담당', provider: 'email', role: 'vendor',
      pw: 'barun@1234', phone: '010-1234-5678', bizNo: '123-45-67890',
      vendorName: '(주)더마린 본사', branchIds: ['gangnam', 'hongdae'], issuedAt: '2026-06-20',
    };
    dirty = true;
  }
  if (!users['bundang.demo@barunn.net']) {
    users['bundang.demo@barunn.net'] = {
      email: 'bundang.demo@barunn.net', name: '박점주', provider: 'email', role: 'vendor',
      pw: 'barun@1234', phone: '010-9876-5432', bizNo: '222-33-44444',
      vendorName: '더마린 분당점(가맹)', branchIds: ['bundang'], issuedAt: '2026-07-01',
    };
    dirty = true;
  }
  if (dirty) setUsers(users);
})();

export const auth = {
  /** 현재 로그인 세션 */
  current(): User | null {
    const email = load<string | null>(SESSION_KEY, null);
    if (!email) return null;
    return getUsers()[email] || null;
  },

  /** 사업자 단위 회원가입 → 승인 대기(approved=false). 직원 승인 후 전 메뉴 사용 가능 */
  async signup(input: SignupInput): Promise<User> {
    await delay();
    const key = norm(input.email);
    const users = getUsers();
    if (users[key]) throw new Error('EXISTS');
    const user: User = {
      email: key, name: input.name, provider: 'email', role: 'vendor',
      pw: input.pw, phone: input.phone, bizNo: input.bizNo, certName: input.certName,
      vendorName: input.vendorName, branchIds: [],
      issuedAt: new Date().toISOString().slice(0, 10),
      approved: false,
    };
    users[key] = user;
    setUsers(users);
    save(SESSION_KEY, key);
    return user;
  },

  /** 직원: 가입 승인 — 승인 즉시 전 메뉴 사용 가능 */
  async approveVendor(email: string): Promise<User> {
    await delay();
    const users = getUsers();
    const u = users[norm(email)];
    if (!u) throw new Error('NOT_FOUND');
    u.approved = true;
    setUsers(users);
    return u;
  },

  /** 직원: 가입 반려 — 계정 삭제 */
  async rejectVendor(email: string): Promise<void> {
    await delay();
    const users = getUsers();
    delete users[norm(email)];
    setUsers(users);
  },

  /** 로그인 — 회원가입(승인제) 또는 직원 발급 계정 */
  async login(email: string, pw: string): Promise<User> {
    await delay();
    const key = norm(email);
    const user = getUsers()[key];
    if (!user || user.pw !== pw) throw new Error('INVALID');
    save(SESSION_KEY, key);
    return user;
  },

  /** Google 로그인 — 바른손카드 내부 직원용. 최초면 자동 가입(staff), 있으면 로그인 */
  async loginWithGoogle(email: string, name: string): Promise<User> {
    await delay();
    const key = norm(email);
    const users = getUsers();
    let user = users[key];
    if (!user) {
      user = { email: key, name: name || key.split('@')[0], provider: 'google', role: 'staff' };
      users[key] = user;
      setUsers(users);
    }
    save(SESSION_KEY, key);
    return user;
  },

  logout() { localStorage.removeItem(SESSION_KEY); },

  /** 업체 정산/사업자 정보 저장 (설정) */
  async updateProfile(patch: VendorProfile): Promise<User> {
    await delay();
    const cur = this.current();
    if (!cur) throw new Error('NO_SESSION');
    const users = getUsers();
    const u = users[cur.email];
    u.profile = { ...(u.profile || {}), ...patch };
    setUsers(users);
    return u;
  },

  // ── 바른손카드 직원(staff) 전용 ──

  /** 발급된 업체(사업자) 계정 목록 */
  async listVendors(): Promise<User[]> {
    await delay();
    return Object.values(getUsers()).filter((u) => u.role === 'vendor');
  },

  /** 직원: 사업자별 계정 발급 (아이디/초기 비밀번호 생성) */
  async issueAccount(input: IssueInput): Promise<User> {
    await delay();
    const key = norm(input.email);
    const users = getUsers();
    if (users[key]) throw new Error('EXISTS');
    const user: User = {
      email: key, name: input.name, provider: 'email', role: 'vendor',
      pw: input.pw, bizNo: input.bizNo,
      vendorName: input.vendorName, branchIds: input.branchIds,
      issuedAt: new Date().toISOString().slice(0, 10),
    };
    users[key] = user;
    setUsers(users);
    return user;
  },

  /** 직원: 계정 회수(비활성화) */
  async revokeAccount(email: string): Promise<void> {
    await delay();
    const users = getUsers();
    delete users[norm(email)];
    setUsers(users);
  },
};
