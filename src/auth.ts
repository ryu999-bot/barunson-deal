// ============================================================
//  인증 / 업체권한 계층 (Auth seam)
//  ──────────────────────────────────────────────────────────
//  지금은 브라우저 localStorage 기반 목(mock)입니다.
//  ⚠ 비밀번호를 평문 저장하므로 데모 전용입니다.
//  바른손카드 백엔드 연동 시:
//   - signup/login → POST /api/auth/...  (세션/JWT 쿠키)
//   - loginWithGoogle → 서버가 Google ID 토큰 검증
//   - requestVendorAccess → POST /api/vendor-access (운영자 승인 큐)
//  함수 시그니처는 그대로 두고 내부만 교체하면 됩니다.
// ============================================================
import { VENDOR } from './config';
import type { VendorProfile } from './types';

export type Provider = 'email' | 'google';
export type Role = 'vendor' | 'staff'; // 업체 | 바른손카드 내부 직원
export type VendorAccess = 'none' | 'pending' | 'granted';

export interface AccessRequest {
  vendorName: string;
  bizNo: string;
  manager: string;
  phone: string;
  at: string;
}

export interface SignupExtra {
  phone: string;
  bizNo: string;
  certName: string; // 첨부한 사업자등록증 파일명 (실제 파일은 백엔드 업로드)
}

export interface User {
  email: string;
  name: string;
  provider: Provider;
  role: Role;
  pw?: string; // 데모 전용(평문). 연동 시 제거.
  phone?: string;
  bizNo?: string;
  certName?: string;
  vendorAccess: VendorAccess;
  vendorName?: string;
  request?: AccessRequest;
  profile?: VendorProfile;
}

const USERS_KEY = 'glowdeal_users';
const SESSION_KEY = 'glowdeal_session';

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function save(key: string, val: unknown) { localStorage.setItem(key, JSON.stringify(val)); }

function getUsers(): Record<string, User> { return load<Record<string, User>>(USERS_KEY, {}); }
function setUsers(u: Record<string, User>) { save(USERS_KEY, u); }
const norm = (e: string) => e.trim().toLowerCase();
const delay = (ms = 50) => new Promise<void>((r) => setTimeout(r, ms));

// 데모 테스트 계정 시드 (최초 1회, 이미 권한 승인 상태). 백엔드 연동 시 제거.
(function seedDemo() {
  const users = getUsers();
  if (!users['demo@barunn.net']) {
    users['demo@barunn.net'] = {
      email: 'demo@barunn.net', name: '김담당', provider: 'email', role: 'vendor',
      pw: 'barun@1234', phone: '010-1234-5678', bizNo: '123-45-67890', certName: '사업자등록증.pdf',
      vendorAccess: 'granted', vendorName: VENDOR.name,
      request: { vendorName: VENDOR.name, bizNo: '123-45-67890', manager: '김담당', phone: '010-1234-5678', at: '2026-06-20' },
    };
    setUsers(users);
  }
})();

export const auth = {
  /** 현재 로그인 세션 */
  current(): User | null {
    const email = load<string | null>(SESSION_KEY, null);
    if (!email) return null;
    return getUsers()[email] || null;
  },

  /** 업체 회원가입 (이메일·이름 + 연락처·사업자등록번호·사업자등록증) */
  async signup(email: string, name: string, pw: string, extra: SignupExtra): Promise<User> {
    await delay();
    const key = norm(email);
    const users = getUsers();
    if (users[key]) throw new Error('EXISTS');
    const user: User = {
      email: key,
      name: name || key.split('@')[0],
      provider: 'email',
      role: 'vendor',
      pw,
      phone: extra.phone,
      bizNo: extra.bizNo,
      certName: extra.certName,
      vendorAccess: 'none',
    };
    users[key] = user;
    setUsers(users);
    save(SESSION_KEY, key);
    return user;
  },

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
      user = { email: key, name: name || key.split('@')[0], provider: 'google', role: 'staff', vendorAccess: 'granted' };
      users[key] = user;
      setUsers(users);
    }
    save(SESSION_KEY, key);
    return user;
  },

  logout() { localStorage.removeItem(SESSION_KEY); },

  /** 업체 권한 요청 → 승인 대기(pending) */
  async requestVendorAccess(req: Omit<AccessRequest, 'at'>): Promise<User> {
    await delay();
    const cur = this.current();
    if (!cur) throw new Error('NO_SESSION');
    const users = getUsers();
    const u = users[cur.email];
    u.vendorAccess = 'pending';
    u.request = { ...req, at: new Date().toISOString().slice(0, 10) };
    setUsers(users);
    return u;
  },

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

  /** 가입한 업체 회원 목록 (직원 콘솔용) */
  async listVendors(): Promise<User[]> {
    await delay();
    return Object.values(getUsers()).filter((u) => u.role === 'vendor');
  },

  /** 직원이 특정 업체의 권한 신청을 승인 */
  async approveVendor(email: string): Promise<User> {
    await delay();
    const users = getUsers();
    const u = users[norm(email)];
    if (!u) throw new Error('NOT_FOUND');
    u.vendorAccess = 'granted';
    u.vendorName = u.request?.vendorName || VENDOR.name;
    setUsers(users);
    return u;
  },

  /** 직원이 권한을 반려(none으로 되돌림) */
  async rejectVendor(email: string): Promise<User> {
    await delay();
    const users = getUsers();
    const u = users[norm(email)];
    if (!u) throw new Error('NOT_FOUND');
    u.vendorAccess = 'none';
    setUsers(users);
    return u;
  },
};
