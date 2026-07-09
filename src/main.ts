import './style.css';
import type { Coupon, BranchKind, Branch } from './types';
import { VENDOR, BRAND, BRANCHES, branchOf, PAYOUT_DAY, BASE_DATE, todayStr, ymd, won, GOOGLE_CLIENT_ID } from './config';
import { balanceOf, realStatus, STATUS_META, discPct, refundDue, settleLines, groupByPayee } from './domain';
import { api } from './api';
import { auth, type User } from './auth';

declare const google: any;

const today = BASE_DATE;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// 현재 로드된 쿠폰 캐시 (api에서 갱신)
let coupons: Coupon[] = [];
async function reload() { coupons = await api.listCoupons(); }

// 현재 처리 지점 — 계정의 지점 스코프 내에서만 선택 가능 (enterApp의 initBranchSel에서 설정)
let branch = BRANCHES[0];
($('branchSel') as HTMLSelectElement).onchange = () => {
  branch = branchOf(($('branchSel') as HTMLSelectElement).value);
  toast(`처리 지점: ${branch.name} (${branch.kind === 'franchise' ? '가맹' : '직영'})`);
};
const branchLabel = (id?: string) => {
  const b = branchOf(id);
  return `${b.name}${b.kind === 'franchise' ? '<span style="color:var(--sub);font-size:var(--fs-cap)"> 가맹</span>' : ''}`;
};
// 쿠폰의 사용 지점 표시 — 사용된 지점(들), 미사용이면 구매 지점
const branchCell = (c: Coupon): string => {
  if (c.type === 'amount' || c.type === 'count') {
    const ids = [...new Set((c.history || []).map((h) => branchOf(h.branchId || c.branchId).id))];
    if (ids.length) return ids.map(branchLabel).join(', ');
  } else if (c.usedBranchId || realStatus(c) === 'used') {
    return branchLabel(c.usedBranchId || c.branchId);
  }
  return `<span style="color:var(--sub)">구매: ${branchOf(c.branchId).name}</span>`;
};

// 현재 사용자
let user: User | null = null;

// 계정에 묶인 지점 스코프 — 본사 계정: 직영 지점들 / 가맹 계정: 자기 지점 / 직원: 전체
const allowedBranches = () =>
  user?.role === 'vendor' && user.branchIds?.length ? BRANCHES.filter((b) => user!.branchIds!.includes(b.id)) : BRANCHES;
const allowedIds = () => new Set(allowedBranches().map((b) => b.id));

// ── 사용 범위 규칙: 쿠폰은 "판매 지점을 운영하는 사업자(정산주체)"의 지점에서만 사용 가능.
//    직영 계열(본사 사업자 1개)은 직영 지점 간 교차 사용 가능, 가맹점 쿠폰은 해당 가맹점 전용.
const payeeOf = (c: Coupon) => branchOf(c.branchId).payee;
const myPayees = () => new Set(allowedBranches().map((b) => b.payee));
const canRedeem = (c: Coupon) => user?.role !== 'vendor' || myPayees().has(payeeOf(c));
// 쿠폰을 사용할 수 있는 지점들 (동일 사업자 소속)
const usableBranches = (c: Coupon) => BRANCHES.filter((b) => b.payee === payeeOf(c));

// 이 계정(사업자)의 쿠폰 — 판매현황·정산·사용처리 검색 공통 스코프
function visibleCoupons(): Coupon[] {
  if (user?.role !== 'vendor' || !user.branchIds?.length) return coupons;
  const payees = myPayees();
  return coupons.filter((c) => payees.has(payeeOf(c)));
}

/* ================= Auth (로그인 — 계정은 바른손카드가 사업자별 발급) ================= */
$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = ($('auEmail') as HTMLInputElement).value.trim();
  const pw = ($('auPw') as HTMLInputElement).value;
  if (!email || !pw) { toast('⚠️ 아이디와 비밀번호를 입력하세요'); return; }
  try {
    user = await auth.login(email, pw);
    await enterApp();
  } catch {
    toast('⚠️ 아이디 또는 비밀번호가 올바르지 않아요. 계정 문의: jungmin.kim@barunn.net');
  }
};

function decodeJwt(t: string): any {
  try {
    const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch { return {}; }
}
async function onGoogle(email: string, name: string) {
  try { user = await auth.loginWithGoogle(email, name); await enterApp(); }
  catch { toast('⚠️ Google 로그인에 실패했어요'); }
}
function initGoogle() {
  if (GOOGLE_CLIENT_ID && typeof google !== 'undefined' && google.accounts) {
    $('googleDemoBtn').style.display = 'none';
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (resp: any) => { const p = decodeJwt(resp.credential); onGoogle(p.email, p.name); },
    });
    google.accounts.id.renderButton($('googleBtn'), { theme: 'outline', size: 'large', width: 332, text: 'continue_with' });
  } else {
    $('googleDemoBtn').style.display = 'flex'; // Client ID 미설정 → 데모 모드
  }
}
$('googleDemoBtn').onclick = () => onGoogle('staff.demo@barunn.net', '바른손카드 직원(데모)');
if (GOOGLE_CLIENT_ID) {
  const iv = window.setInterval(() => { if (typeof google !== 'undefined' && google.accounts) { clearInterval(iv); initGoogle(); } }, 200);
  window.setTimeout(() => clearInterval(iv), 4000);
} else { initGoogle(); }

async function enterApp() {
  if (!user) return;
  $('authView').style.display = 'none';
  $('adminView').style.display = 'block';
  // 데이터 로드 전에 사용자 표시부터 갱신 (이전 세션 잔상 방지)
  renderUserBar();
  applyRole();
  initBranchSel();
  await reload();
  showView(user.role === 'staff' ? 'ops' : 'dashboard');
}

// 처리 지점 셀렉터를 계정 스코프로 제한 — 지점이 1개면 고정(변경 불가)
function initBranchSel() {
  const sel = $('branchSel') as HTMLSelectElement;
  const list = allowedBranches();
  branch = list[0];
  sel.innerHTML = list.map((b) => `<option value="${b.id}">${b.name} · ${b.kind === 'franchise' ? '가맹' : '직영'}</option>`).join('');
  sel.disabled = list.length === 1;
}
$('logoutBtn').onclick = () => {
  auth.logout();
  user = null;
  $('adminView').style.display = 'none';
  $('authView').style.display = 'block';
};

function renderUserBar() {
  if (!user) return;
  const badge = user.role === 'staff'
    ? `<span class="access-badge">🛡 바른손카드 직원</span>`
    : `<span class="access-badge">🏪 ${user.vendorName || VENDOR.name}</span>`;
  $('userInfo').innerHTML = `<span class="uname">${user.name}</span>${badge}`;
}
function applyRole() {
  const role = user?.role || 'vendor';
  document.querySelectorAll<HTMLElement>('[data-role]').forEach((el) => {
    el.style.display = el.dataset.role === role ? '' : 'none';
  });
}

/* ================= Nav ================= */
function showView(v: string) {
  if ((v === 'staff' || v === 'ops') && user?.role !== 'staff') v = 'dashboard';
  document.querySelectorAll('.view').forEach((x) => x.classList.remove('show'));
  $('view-' + v).classList.add('show');
  document.querySelectorAll('.nav-item').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.view === v));
  if (v === 'dashboard') renderDashboard();
  if (v === 'settlement') renderSettlement();
  if (v === 'ops') renderOps();
  if (v === 'staff') renderStaff();
  if (v === 'sms') renderSms();
  if (v === 'statements') renderStatements();
  if (v === 'settings') renderSettings();
  if (v === 'notice') renderNotice();
  if (v === 'branches') renderBranches();
  if (v === 'redeem') $('searchInput').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================= 운영 대시보드 (바른손카드) ================= */
async function renderOps() {
  const stats = await api.getOpsStats();
  const totalRev = stats.reduce((s, v) => s + v.revenue, 0);
  const totalSettle = stats.reduce((s, v) => s + v.settle, 0);
  const totalIssued = stats.reduce((s, v) => s + v.issued, 0);
  const totalUsed = stats.reduce((s, v) => s + v.used, 0);
  const usageRate = totalIssued ? Math.round((totalUsed / totalIssued) * 100) : 0;
  $('opsStats').innerHTML = `
    <div class="stat gold"><div class="lbl">총 매출액</div><div class="num">${won(totalRev)}<small> 원</small></div><div class="sub2">전체 결제액</div></div>
    <div class="stat accent"><div class="lbl">총 정산액</div><div class="num">${won(totalSettle)}<small> 원</small></div><div class="sub2">사용 기준 누계</div></div>
    <div class="stat green"><div class="lbl">평균 쿠폰 사용률</div><div class="num">${usageRate}<small> %</small></div><div class="sub2">${totalUsed}/${totalIssued}건</div></div>
    <div class="stat"><div class="lbl">입점 업체</div><div class="num">${stats.length}<small> 곳</small></div><div class="sub2">판매중</div></div>`;
  const rows = stats.slice().sort((a, b) => b.revenue - a.revenue);
  $('opsList').innerHTML = `<table><thead><tr>
    <th>업체</th><th class="col-hide">지역</th><th class="num">매출액</th><th class="num">발급</th><th class="num">사용</th><th>사용률</th><th class="num">정산액</th>
    </tr></thead><tbody>${rows.map((v) => {
      const rate = v.issued ? Math.round((v.used / v.issued) * 100) : 0;
      return `<tr>
        <td><b>${v.vendor}</b></td>
        <td class="col-hide">${v.region}</td>
        <td class="num">${won(v.revenue)}</td>
        <td class="num">${v.issued}</td>
        <td class="num">${v.used}</td>
        <td><div style="display:flex;align-items:center;gap:8px"><div class="bar" style="flex:1"><i style="width:${rate}%"></i></div><span style="font-size:var(--fs-cap);color:var(--sub);white-space:nowrap">${rate}%</span></div></td>
        <td class="num"><b>${won(v.settle)}</b></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

/* ================= 직원 콘솔 (계정 발급) ================= */
async function renderStaff() {
  const vendors = await auth.listVendors();
  const branchCount = new Set(vendors.flatMap((v) => v.branchIds || [])).size;
  $('staffStats').innerHTML = `
    <div class="stat"><div class="lbl">발급 계정</div><div class="num">${vendors.length}<small> 개</small></div><div class="sub2">사업자 기준</div></div>
    <div class="stat green"><div class="lbl">연결 지점</div><div class="num">${branchCount}<small> 곳</small></div><div class="sub2">직영+가맹</div></div>
    <div class="stat accent"><div class="lbl">브랜드 지점</div><div class="num">${BRANCHES.length}<small> 곳</small></div><div class="sub2">등록 기준</div></div>`;

  // 발급 폼 — 운영 지점 체크박스
  $('isBranches').innerHTML = BRANCHES.map((b) =>
    `<label class="check" style="margin:0"><input type="checkbox" class="isBr" value="${b.id}" /> ${b.name}(${b.kind === 'franchise' ? '가맹' : '직영'})</label>`).join('');
  $('issueForm').onsubmit = async (e) => {
    e.preventDefault();
    const g = (id: string) => ($(id) as HTMLInputElement).value.trim();
    const branchIds = [...document.querySelectorAll<HTMLInputElement>('.isBr:checked')].map((c) => c.value);
    if (!g('isVendor') || !g('isEmail') || !g('isPw')) { toast('⚠️ 사업자명·아이디·초기 비밀번호를 입력하세요'); return; }
    if (!branchIds.length) { toast('⚠️ 운영 지점을 1개 이상 선택하세요'); return; }
    try {
      await auth.issueAccount({ email: g('isEmail'), name: g('isName') || g('isVendor'), pw: g('isPw'), vendorName: g('isVendor'), bizNo: g('isBiz'), branchIds });
      ($('issueForm') as HTMLFormElement).reset();
      toast('✓ 계정을 발급했어요');
      renderStaff();
    } catch { toast('⚠️ 이미 발급된 아이디예요'); }
  };

  const box = $('staffList');
  if (!vendors.length) {
    box.innerHTML = `<div class="no-result"><div class="ico">🗂️</div><div class="lead">발급된 계정이 없어요.</div>위에서 사업자별 계정을 발급하세요.</div>`;
  } else {
    box.innerHTML = `<table><thead><tr>
      <th>사업자(정산주체)</th><th class="col-hide">아이디</th><th>운영 지점</th><th class="col-hide">사업자번호</th><th>발급일</th><th>처리</th>
      </tr></thead><tbody>${vendors.map((v) => `<tr>
        <td><b>${v.vendorName || '-'}</b><div style="color:var(--sub);font-size:var(--fs-cap)">${v.name}</div></td>
        <td class="col-hide">${v.email}</td>
        <td>${(v.branchIds || []).map((id) => branchOf(id).name).join(', ') || '-'}</td>
        <td class="col-hide">${v.bizNo || '-'}</td>
        <td>${v.issuedAt || '-'}</td>
        <td><button class="btn-mini ghost revoke" data-email="${v.email}">회수</button></td>
      </tr>`).join('')}</tbody></table>`;
    box.querySelectorAll('.revoke').forEach((b) => ((b as HTMLElement).onclick = async () => {
      await auth.revokeAccount((b as HTMLElement).dataset.email!);
      toast('계정을 회수했어요');
      renderStaff();
    }));
  }
  bindNoticeAdmin();
}

function bindNoticeAdmin() {
  $('noticeForm').onsubmit = async (e) => {
    e.preventDefault();
    const title = ($('ntTitle') as HTMLInputElement).value.trim();
    const body = ($('ntBody') as HTMLTextAreaElement).value.trim();
    const pinned = ($('ntPinned') as HTMLInputElement).checked;
    if (!title || !body) { toast('⚠️ 제목과 내용을 입력하세요'); return; }
    await api.addNotice({ title, body, pinned });
    (e.target as HTMLFormElement).reset();
    toast('✓ 공지를 등록했어요');
    renderStaffNotices();
  };
  renderStaffNotices();
}
async function renderStaffNotices() {
  const list = await api.listNotices();
  const box = $('staffNoticeList');
  if (!list.length) { box.innerHTML = `<p class="desc">등록된 공지가 없습니다.</p>`; return; }
  box.innerHTML = list.map((n) => `
    <div class="notice ${n.pinned ? 'pinned' : ''}">
      <div class="notice-top"><span class="notice-title">${n.pinned ? '📌 ' : ''}${n.title}</span><span class="notice-date">${n.date} · <button class="link-del" data-id="${n.id}">삭제</button></span></div>
      <p class="notice-body">${n.body}</p>
    </div>`).join('');
  box.querySelectorAll('.link-del').forEach((b) => ((b as HTMLElement).onclick = async () => {
    await api.deleteNotice(Number((b as HTMLElement).dataset.id));
    toast('공지를 삭제했어요');
    renderStaffNotices();
  }));
}
document.querySelectorAll('.nav-item').forEach((b) => ((b as HTMLElement).onclick = () => showView((b as HTMLElement).dataset.view!)));

/* ================= 지점 관리 ================= */
async function renderBranches() {
  const list = await api.listBranches();
  const acct = (b: Branch) => b.settleAccount ? `${b.settleBank ?? ''} ${b.settleAccount}${b.settleHolder ? ` (${b.settleHolder})` : ''}`.trim() : '<span class="desc">본사 계좌</span>';
  $('branchList').innerHTML = list.length
    ? `<table class="tbl"><thead><tr><th>지점명</th><th>구분</th><th>정산주체(payee)</th><th>정산계좌</th></tr></thead><tbody>${list
        .map((b) => `<tr><td>${b.name}</td><td>${b.kind === 'franchise' ? '가맹' : '직영'}</td><td>${b.payee}</td><td>${acct(b)}</td></tr>`)
        .join('')}</tbody></table>`
    : `<p class="desc">등록된 지점이 없습니다. 위에서 지점을 등록하세요.</p>`;
}
(document.getElementById('branchForm') as HTMLFormElement | null)?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const g = (id: string) => ($(id) as HTMLInputElement).value.trim();
  const name = g('brName');
  if (!name) { toast('⚠️ 지점명을 입력하세요'); return; }
  const kind = ($('brKind') as HTMLSelectElement).value as BranchKind;
  await api.addBranch({ name, kind, phone: g('brPhone'), addr: g('brAddr'), settleBank: g('brBank'), settleAccount: g('brAccount'), settleHolder: g('brHolder') });
  toast('✓ 지점을 등록했어요');
  ['brName', 'brPhone', 'brAddr', 'brBank', 'brAccount', 'brHolder'].forEach((id) => (($(id) as HTMLInputElement).value = ''));
  initBranchSel();   // 처리 지점 셀렉터 갱신
  renderBranches();
});

/* ================= Row HTML ================= */
const maskPhone = (p: string) => p.replace(/(\d{3})-(\d{2})\d{2}-(\d{4})/, '$1-$2**-$3');
const TYPE_BADGE: Record<string, string> = {
  amount: '<span class="badge amount">자유이용권</span>',
  count: '<span class="badge count">다회권</span>',
  service: '<span class="badge info">일반 쿠폰</span>',
};
const typeBadge = (c: Coupon) => TYPE_BADGE[c.type];

function rowHTML(c: Coupon) {
  const st = STATUS_META[realStatus(c)];
  let extra: string;
  if (c.type === 'amount' || c.type === 'count') {
    const pct = Math.round((c.used || 0) / (c.face || 1) * 100);
    const balTxt = c.type === 'count' ? `잔여 <b>${balanceOf(c)}</b>회 / 총 ${c.face}회` : `잔액 <b>${won(balanceOf(c))}</b>원`;
    extra = `<div>${balTxt}</div><div class="bar"><i style="width:${pct}%"></i></div>`;
  } else {
    const d = discPct(c);
    const price = c.origin
      ? `<span style="color:var(--sub);text-decoration:line-through">${won(c.origin)}</span> → <b>${won(c.paid)}</b>원${d ? ` <span style="color:var(--accent-deep);font-weight:600">${d}%</span>` : ''}`
      : `<b>${won(c.paid)}</b>원`;
    extra = `<div class="pname">${c.product}</div><div style="font-size:var(--fs-cap);margin-top:3px">${price}</div>`;
  }
  return `<tr class="clickable" data-code="${c.code}">
    <td class="code">${c.code}</td>
    <td>${c.name}<div style="color:var(--sub);font-size:var(--fs-cap)" class="col-hide">${maskPhone(c.phone)}</div></td>
    <td>${typeBadge(c)}</td>
    <td>${extra}</td>
    <td class="col-hide">${branchCell(c)}</td>
    <td>${c.expire}</td>
    <td><span class="badge ${st.cls}"><span class="ic">${st.ic}</span>${st.txt}</span></td>
  </tr>`;
}
function bindRows(box: HTMLElement) {
  box.querySelectorAll('tr[data-code]').forEach((tr) => ((tr as HTMLElement).onclick = () => openDetail((tr as HTMLElement).dataset.code!)));
}

/* ================= Dashboard ================= */
let dashFilter = 'all';
// 실제 거래(사용)가 발생한 쿠폰 — 이때만 고객 정보 노출 허용
const transacted = (c: Coupon) => (c.type === 'amount' || c.type === 'count' ? (c.used || 0) > 0 : realStatus(c) === 'used');

function renderDashboard() {
  const mine = visibleCoupons(); // 계정 지점 스코프 (구매 또는 사용이 자기 지점인 쿠폰)
  const total = mine.length;
  const usedCnt = mine.filter(transacted).length;
  const todayUsed =
    mine.filter((c) => c.usedAt && c.usedAt.startsWith(todayStr)).length +
    mine.filter((c) => c.type === 'amount' && (c.history || []).some((h) => h.date.startsWith(todayStr))).length;
  const grossPaid = mine.filter((c) => realStatus(c) !== 'refunded').reduce((s, c) => s + c.paid, 0);
  $('dashStats').innerHTML = `
    <div class="stat"><div class="lbl">누적 판매</div><div class="num">${total}<small> 건</small></div><div class="sub2">구매된 전체</div></div>
    <div class="stat green"><div class="lbl">사용 완료</div><div class="num">${usedCnt}<small> 건</small></div><div class="sub2">방문·사용처리</div></div>
    <div class="stat accent"><div class="lbl">오늘 사용처리</div><div class="num">${todayUsed}<small> 건</small></div><div class="sub2">${todayStr}</div></div>
    <div class="stat gold"><div class="lbl">확정 매출</div><div class="num">${won(grossPaid)}<small> 원</small></div><div class="sub2">결제대금 합계</div></div>`;
  renderDashSummary();
  renderDashList();
}

// 상품별 판매 집계 (개인정보 미포함)
function renderDashSummary() {
  const map = new Map<string, { product: string; sold: number; used: number; revenue: number }>();
  for (const c of visibleCoupons()) {
    if (realStatus(c) === 'refunded') continue;
    const e = map.get(c.product) || { product: c.product, sold: 0, used: 0, revenue: 0 };
    e.sold++;
    e.revenue += c.paid;
    if (transacted(c)) e.used++;
    map.set(c.product, e);
  }
  const rows = [...map.values()].sort((a, b) => b.revenue - a.revenue);
  $('dashSummary').innerHTML = `<table><thead><tr>
    <th>상품</th><th class="num">판매</th><th class="num">사용</th><th class="num">매출(결제액)</th>
    </tr></thead><tbody>${rows.map((r) => `<tr>
      <td>${r.product}</td>
      <td class="num">${r.sold}건</td>
      <td class="num">${r.used}건</td>
      <td class="num">${won(r.revenue)}원</td>
    </tr>`).join('')}</tbody></table>`;
}

function renderDashList() {
  const list = visibleCoupons().filter(transacted).filter((c) => (dashFilter === 'all' ? true : c.type === dashFilter));
  const box = $('dashList');
  if (!list.length) {
    box.innerHTML = `<div class="no-result"><div class="ico">🧾</div><div class="lead">아직 사용된 쿠폰이 없어요.</div>고객이 방문해 사용처리하면 여기에 표시됩니다.</div>`;
    return;
  }
  box.innerHTML = `<table><thead><tr>
    <th>쿠폰번호</th><th>고객</th><th>유형</th><th>잔액 / 상품</th><th class="col-hide">사용 지점</th><th>유효기간</th><th>상태</th>
    </tr></thead><tbody>${list.map(rowHTML).join('')}</tbody></table>`;
  bindRows(box);
}
$('dashTabs').onclick = (e) => {
  const t = (e.target as HTMLElement).closest('.tab') as HTMLElement;
  if (!t) return;
  document.querySelectorAll('#dashTabs .tab').forEach((x) => x.classList.remove('on'));
  t.classList.add('on');
  dashFilter = t.dataset.filter!;
  renderDashList();
};

/* ================= Search (redeem) ================= */
let mode = 'all';
$('searchTabs').onclick = (e) => {
  const t = (e.target as HTMLElement).closest('.tab') as HTMLElement;
  if (!t) return;
  document.querySelectorAll('#searchTabs .tab').forEach((x) => x.classList.remove('on'));
  t.classList.add('on');
  mode = t.dataset.mode!;
  const ph: Record<string, string> = {
    all: '쿠폰번호, 연락처, 이름으로 검색',
    code: '쿠폰번호 입력 (예: GL26-8842-1097)',
    phone: '연락처 입력 (끝 4자리만 입력해도 됩니다)',
    name: '고객 이름 입력',
  };
  ($('searchInput') as HTMLInputElement).placeholder = ph[mode];
};
function runSearch() {
  const q = ($('searchInput') as HTMLInputElement).value.trim().toLowerCase().replace(/\s/g, '');
  const box = $('searchResults');
  if (!q) {
    box.innerHTML = `<div class="no-result"><div class="ico">⌨️</div><div class="lead">조회할 쿠폰을 찾아보세요.</div>쿠폰번호 · 연락처 · 이름 중 하나를 입력하면 됩니다.</div>`;
    return;
  }
  const digits = q.replace(/\D/g, '');
  const match = (c: Coupon) => {
    const code = c.code.toLowerCase().replace(/-/g, '');
    const phone = c.phone.replace(/\D/g, '');
    const name = c.name.toLowerCase();
    if (mode === 'code') return code.includes(q.replace(/-/g, ''));
    if (mode === 'phone') return !!digits && phone.includes(digits);
    if (mode === 'name') return name.includes(q);
    return code.includes(q.replace(/-/g, '')) || (!!digits && phone.includes(digits)) || name.includes(q);
  };
  // 자기 사업자(정산주체) 쿠폰만 사용처리 대상
  const hits = visibleCoupons().filter(match);
  if (!hits.length) {
    // 브랜드 내 다른 사업자 지점의 쿠폰이면 안내
    const other = coupons.filter(match).filter((c) => !canRedeem(c));
    box.innerHTML = other.length
      ? `<div class="no-result"><div class="ico">🚫</div><div class="lead">다른 사업자 지점의 쿠폰이에요.</div>이 쿠폰은 <b>${payeeOf(other[0])}</b> (${usableBranches(other[0]).map((b) => b.name).join('·')}) 에서만 사용처리할 수 있습니다.</div>`
      : `<div class="no-result"><div class="ico">🔍</div><div class="lead">일치하는 쿠폰이 없어요.</div>번호를 다시 확인하거나, 연락처 끝 4자리·이름으로 조회해 보세요.</div>`;
    return;
  }
  box.innerHTML = `<table><thead><tr>
    <th>쿠폰번호</th><th>고객</th><th>유형</th><th>잔액 / 상품</th><th class="col-hide">사용 지점</th><th>유효기간</th><th>상태</th>
    </tr></thead><tbody>${hits.map(rowHTML).join('')}</tbody></table>`;
  bindRows(box);
}
$('searchBtn').onclick = runSearch;
$('searchInput').addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') runSearch(); });

/* ================= Detail / redeem / deduct ================= */
type PendingAction =
  | { kind: 'redeem'; code: string }
  | { kind: 'deduct'; code: string; amount: number }
  | { kind: 'deduct-count'; code: string; amount: number }; // amount = 회수
let pending: PendingAction | null = null;

const kwOf = (c: Coupon) => (c.type === 'amount' ? '금액형 자유이용권' : c.type === 'count' ? '횟수형 다회권' : '모바일 교환권');

function openDetail(code: string) {
  const c = coupons.find((x) => x.code === code);
  if (!c) return;
  const st = realStatus(c);
  let body = '', foot = '';

  if (c.type === 'amount') {
    const bal = balanceOf(c);
    const pct = Math.round((c.used || 0) / (c.face || 1) * 100);
    const histHTML =
      c.history && c.history.length
        ? `<div class="hist"><div class="ht">사용(차감) 내역</div>${c.history.map((h) => `<div class="hi"><span>${h.date} · ${branchOf(h.branchId || c.branchId).name}</span><span>−${won(h.amount)}원</span></div>`).join('')}</div>`
        : '';
    body = `
      <div class="balance-box">
        <div class="bl">남은 잔액</div>
        <div class="bv">${won(bal)}<span style="font-size:16px"> 원</span></div>
        <div class="bsub">총 액면 ${won(c.face || 0)}원 · 사용 ${won(c.used || 0)}원 (${pct}%)</div>
      </div>
      <div class="drow"><span class="k">고객명</span><span class="v">${c.name}</span></div>
      <div class="drow"><span class="k">연락처</span><span class="v">${c.phone}</span></div>
      <div class="drow"><span class="k">결제금액</span><span class="v">${won(c.paid)}원</span></div>
      <div class="drow"><span class="k">구매 지점</span><span class="v">${branchOf(c.branchId).name} <span style="font-weight:400;color:var(--sub)">· 사용 가능: ${usableBranches(c).map((b) => b.name).join('·')}</span></span></div>
      <div class="drow"><span class="k">유효기간</span><span class="v">~ ${c.expire}</span></div>
      ${histHTML}`;
    if (st === 'available') {
      foot = `
        <label style="font-size:var(--fs-cap);font-weight:600;color:var(--ink);letter-spacing:.06em;text-transform:uppercase">사용(차감) 금액</label>
        <div class="deduct-row"><input id="deductInput" type="number" inputmode="numeric" placeholder="0" max="${bal}" /></div>
        <div class="chips">
          <button class="chip" data-v="100000">+10만</button>
          <button class="chip" data-v="200000">+20만</button>
          <button class="chip" data-v="500000">+50만</button>
          <button class="chip" data-v="${bal}">전액(${won(bal)})</button>
        </div>
        <button class="btn-redeem" id="deductBtn">차감 처리하기</button>`;
    } else if (st === 'expired') {
      const rf = refundDue(c);
      foot = `<div class="status-note exp">유효기간이 지났어요 (${c.expire})${rf ? `<br>미사용 잔액 ${won(bal)}원 → 환불 대상액 약 ${won(rf)}원` : ''}</div><button class="btn-redeem" disabled>차감 불가</button>`;
    } else {
      foot = `<div class="status-note done">✓ 잔액을 모두 사용했어요</div><button class="btn-redeem" disabled>차감 불가</button>`;
    }
  } else if (c.type === 'count') {
    const bal = balanceOf(c); // 잔여 회수
    const total = c.face || 0;
    const unit = total ? Math.round(c.paid / total) : 0;
    const pct = Math.round((c.used || 0) / (total || 1) * 100);
    const histHTML =
      c.history && c.history.length
        ? `<div class="hist"><div class="ht">사용(회차) 내역</div>${c.history.map((h) => `<div class="hi"><span>${h.date} · ${branchOf(h.branchId || c.branchId).name}</span><span>−${h.amount}회</span></div>`).join('')}</div>`
        : '';
    body = `
      <div class="balance-box">
        <div class="bl">남은 횟수</div>
        <div class="bv">${bal}<span style="font-size:16px"> 회</span></div>
        <div class="bsub">총 ${total}회 · 사용 ${c.used || 0}회 (${pct}%) · 회당 정산 약 ${won(unit)}원</div>
      </div>
      <div class="drow"><span class="k">고객명</span><span class="v">${c.name}</span></div>
      <div class="drow"><span class="k">연락처</span><span class="v">${c.phone}</span></div>
      <div class="drow"><span class="k">결제금액</span><span class="v">${won(c.paid)}원${c.origin ? ` <span style="font-weight:400;color:var(--sub);text-decoration:line-through">${won(c.origin)}원</span>` : ''}</span></div>
      <div class="drow"><span class="k">구매 지점</span><span class="v">${branchOf(c.branchId).name} <span style="font-weight:400;color:var(--sub)">· 사용 가능: ${usableBranches(c).map((b) => b.name).join('·')}</span></span></div>
      <div class="drow"><span class="k">유효기간</span><span class="v">~ ${c.expire}</span></div>
      ${histHTML}`;
    if (st === 'available') {
      foot = `
        <label style="font-size:var(--fs-cap);font-weight:600;color:var(--ink);letter-spacing:.06em;text-transform:uppercase">사용 회수</label>
        <div class="deduct-row"><input id="countInput" type="number" inputmode="numeric" value="1" min="1" max="${bal}" /></div>
        <div class="chips">
          <button class="chip" data-v="1">1회</button>
          <button class="chip" data-v="2">2회</button>
          <button class="chip" data-v="${bal}">전체(${bal}회)</button>
        </div>
        <button class="btn-redeem" id="countBtn">회차 차감 처리하기</button>`;
    } else if (st === 'expired') {
      const rf = refundDue(c);
      foot = `<div class="status-note exp">유효기간이 지났어요 (${c.expire})${rf ? `<br>잔여 ${bal}회 → 환불 대상액 약 ${won(rf)}원 (결제액 비례 90%)` : ''}</div><button class="btn-redeem" disabled>차감 불가</button>`;
    } else {
      foot = `<div class="status-note done">✓ 모든 회차를 사용했어요</div><button class="btn-redeem" disabled>차감 불가</button>`;
    }
  } else {
    const d = discPct(c);
    body = `
      <div class="drow"><span class="k">고객명</span><span class="v">${c.name}</span></div>
      <div class="drow"><span class="k">연락처</span><span class="v">${c.phone}</span></div>
      ${c.origin ? `<div class="drow"><span class="k">정상가</span><span class="v" style="font-weight:400;color:var(--sub);text-decoration:line-through">${won(c.origin)}원</span></div>` : ''}
      <div class="drow"><span class="k">판매가(결제)</span><span class="v">${won(c.paid)}원${d ? ` <span style="color:var(--accent-deep)">(${d}% 할인)</span>` : ''}</span></div>
      <div class="drow"><span class="k">구매일</span><span class="v">${c.buyDate}</span></div>
      <div class="drow"><span class="k">구매 지점</span><span class="v">${branchOf(c.branchId).name} <span style="font-weight:400;color:var(--sub)">· 사용 가능: ${usableBranches(c).map((b) => b.name).join('·')}</span></span></div>
      <div class="drow"><span class="k">유효기간</span><span class="v">~ ${c.expire}</span></div>`;
    if (st === 'available') {
      foot = `<button class="btn-redeem" id="redeemBtn">✓ 사용처리하기</button>`;
    } else if (st === 'used') {
      foot = `<div class="status-note used">이미 사용처리된 쿠폰이에요<br><span style="font-weight:600">${c.usedAt} · ${c.usedBy || VENDOR.name}</span></div><button class="btn-redeem" disabled>사용처리 불가</button>`;
    } else {
      foot = `<div class="status-note exp">유효기간이 지난 쿠폰이에요 (${c.expire})</div><button class="btn-redeem" disabled>사용처리 불가</button>`;
    }
  }

  // 타 사업자 쿠폰은 사용처리 차단 (검색에서 걸러지지만 방어적으로 한 번 더)
  if (st === 'available' && !canRedeem(c)) {
    foot = `<div class="status-note exp">이 쿠폰은 <b>${payeeOf(c)}</b> 전용이에요 (사용 지점: ${usableBranches(c).map((b) => b.name).join('·')})</div><button class="btn-redeem" disabled>사용처리 불가</button>`;
  }

  $('ticketBox').innerHTML = `
    <div class="ticket-top">
      <div class="kw">바른라운지 · ${kwOf(c)}</div>
      <div class="pn">${c.product}</div>
      <div class="mm">${STATUS_META[st].txt} 상태</div>
    </div>
    <div class="perf"></div>
    <div class="ticket-mid">
      <div class="ccode">${c.code}</div>
      ${body}
    </div>
    <div class="ticket-foot">${foot}<button class="btn-close" id="closeBtn">닫기</button></div>`;
  $('detailOverlay').classList.add('show');

  $('closeBtn').onclick = closeDetail;
  const rb = document.getElementById('redeemBtn');
  if (rb) rb.onclick = () => askConfirm('이 쿠폰을 사용처리할까요?', `처리 지점: <b>${branch.name}</b> (${branch.kind === 'franchise' ? '가맹' : '직영'}) — 정산은 이 지점에 귀속됩니다.<br>사용처리 후에는 <b>되돌릴 수 없어요.</b> 고객 본인이 방문한 게 맞는지 확인해 주세요.`, { kind: 'redeem', code });
  const db = document.getElementById('deductBtn');
  if (db) {
    const inp = $('deductInput') as HTMLInputElement;
    document.querySelectorAll('#ticketBox .chip').forEach((ch) => ((ch as HTMLElement).onclick = () => {
      const v = parseInt((ch as HTMLElement).dataset.v!);
      if (v === balanceOf(c)) inp.value = String(balanceOf(c));
      else inp.value = String((parseInt(inp.value) || 0) + v);
    }));
    db.onclick = () => {
      const amt = parseInt(inp.value) || 0;
      const bal = balanceOf(c);
      if (amt <= 0) { toast('⚠️ 차감할 금액을 입력하세요'); return; }
      if (amt > bal) { toast('⚠️ 잔액보다 큰 금액은 차감할 수 없어요'); return; }
      askConfirm(`${won(amt)}원을 차감할까요?`, `처리 지점: <b>${branch.name}</b> (${branch.kind === 'franchise' ? '가맹' : '직영'}) — 정산은 이 지점에 귀속됩니다.<br>차감 후 잔액은 <b>${won(bal - amt)}원</b>이 됩니다. 처리 후에는 되돌릴 수 없어요.`, { kind: 'deduct', code, amount: amt });
    };
  }
  const cb = document.getElementById('countBtn');
  if (cb) {
    const inp = $('countInput') as HTMLInputElement;
    document.querySelectorAll('#ticketBox .chip').forEach((ch) => ((ch as HTMLElement).onclick = () => {
      inp.value = (ch as HTMLElement).dataset.v!;
    }));
    cb.onclick = () => {
      const amt = parseInt(inp.value) || 0;
      const bal = balanceOf(c);
      if (amt <= 0) { toast('⚠️ 사용할 회수를 입력하세요'); return; }
      if (amt > bal) { toast('⚠️ 잔여 회수보다 많이 차감할 수 없어요'); return; }
      askConfirm(`${amt}회를 차감할까요?`, `처리 지점: <b>${branch.name}</b> (${branch.kind === 'franchise' ? '가맹' : '직영'}) — 정산은 이 지점에 귀속됩니다.<br>차감 후 잔여 횟수는 <b>${bal - amt}회</b>가 됩니다. 처리 후에는 되돌릴 수 없어요.`, { kind: 'deduct-count', code, amount: amt });
    };
  }
}
function closeDetail() { $('detailOverlay').classList.remove('show'); }
$('detailOverlay').onclick = (e) => { if ((e.target as HTMLElement).id === 'detailOverlay') closeDetail(); };

/* ================= Confirm ================= */
function askConfirm(title: string, msg: string, action: PendingAction) {
  pending = action;
  $('confirmTitle').innerHTML = title;
  $('confirmMsg').innerHTML = msg;
  $('confirmOverlay').classList.add('show');
}
$('confirmCancel').onclick = () => $('confirmOverlay').classList.remove('show');
$('confirmOverlay').onclick = (e) => { if ((e.target as HTMLElement).id === 'confirmOverlay') $('confirmOverlay').classList.remove('show'); };
$('confirmOk').onclick = async () => {
  if (!pending) return;
  const action = pending;
  pending = null;
  $('confirmOverlay').classList.remove('show');

  const target = coupons.find((x) => x.code === action.code);
  if (!target || realStatus(target) !== 'available') {
    toast('⚠️ 이미 처리됐거나 사용할 수 없는 쿠폰이에요');
    return;
  }
  try {
    const vname = `${BRAND} ${branch.name}`;
    if (action.kind === 'redeem') {
      const c = await api.redeem(action.code, branch.id);
      await reload();
      const msg = `[바른라운지] ${c.name}님, '${c.product}' 쿠폰이 정상 사용처리되었습니다. 이용해 주셔서 감사합니다. - ${vname}`;
      await api.sendSms(c.phone, msg, 'redeem');
      showReceipt(c, '사용처리 완료', [['고객명', c.name], ['쿠폰번호', c.code], ['처리일시', c.usedAt || ''], ['처리지점', c.usedBy || vname]], { phone: c.phone, message: msg });
      toast('✓ 사용처리 완료 · 고객 문자 발송');
    } else if (action.kind === 'deduct-count') {
      const c = await api.deduct(action.code, action.amount, branch.id);
      await reload();
      const bal = balanceOf(c); // 잔여 회수
      const msg = bal <= 0
        ? `[바른라운지] ${c.name}님, '${c.product}' ${action.amount}회 사용으로 모든 회차를 사용하셨습니다(잔여 0회). 이용 감사합니다. - ${vname}`
        : `[바른라운지] ${c.name}님, '${c.product}' ${action.amount}회 사용. 남은 횟수 ${bal}회. - ${vname}`;
      await api.sendSms(c.phone, msg, bal <= 0 ? 'used-up' : 'deduct');
      showReceipt(c, `${action.amount}회 차감 완료`, [['고객명', c.name], ['차감회수', action.amount + '회'], ['남은 횟수', bal + '회'], ['처리지점', vname], ['처리일시', c.history && c.history.length ? c.history[c.history.length - 1].date : '']], { phone: c.phone, message: msg });
      toast(bal <= 0 ? '✓ 차감 완료 · 회차 소진 문자 발송' : `✓ ${action.amount}회 차감 · 문자 발송`);
    } else {
      const c = await api.deduct(action.code, action.amount, branch.id);
      await reload();
      const bal = balanceOf(c);
      const msg = bal <= 0
        ? `[바른라운지] ${c.name}님, '${c.product}' ${won(action.amount)}원 사용으로 잔액을 모두 사용하셨습니다(잔액 0원). 이용 감사합니다. - ${vname}`
        : `[바른라운지] ${c.name}님, '${c.product}' ${won(action.amount)}원 사용. 남은 잔액 ${won(bal)}원. - ${vname}`;
      await api.sendSms(c.phone, msg, bal <= 0 ? 'used-up' : 'deduct');
      showReceipt(c, `${won(action.amount)}원 차감 완료`, [['고객명', c.name], ['차감금액', won(action.amount) + '원'], ['남은 잔액', won(bal) + '원'], ['처리지점', vname], ['처리일시', c.history && c.history.length ? c.history[c.history.length - 1].date : '']], { phone: c.phone, message: msg });
      toast(bal <= 0 ? '✓ 차감 완료 · 잔액 소진 문자 발송' : `✓ ${won(action.amount)}원 차감 · 문자 발송`);
    }
  } catch {
    toast('⚠️ 처리 중 문제가 발생했어요');
  }
  refreshAll();
};
function showReceipt(c: Coupon, headline: string, rows: [string, string][], sms?: { phone: string; message: string }) {
  const smsBlock = sms
    ? `<div class="sms-note">📱 고객 알림 문자 발송 → <b>${sms.phone}</b><div class="sms-msg">${sms.message}</div></div>`
    : '';
  $('ticketBox').innerHTML = `
    <div class="ticket-top" style="background:linear-gradient(135deg,#1A8C73,#0E7C5A)">
      <div class="kw">바른라운지 · ${kwOf(c)}</div>
      <div class="pn">${c.product}</div>
      <div class="mm">${headline}</div>
    </div>
    <div class="perf"></div>
    <div class="ticket-mid">
      <div class="status-note done">✓ ${headline}</div>
      ${rows.map((r) => `<div class="drow"><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`).join('')}
      ${smsBlock}
    </div>
    <div class="ticket-foot"><button class="btn-close" id="closeBtn2">확인</button></div>`;
  $('closeBtn2').onclick = () => { closeDetail(); refreshAll(); };
}
function refreshAll() {
  renderDashboard();
  if ($('searchResults').innerHTML.trim() && ($('searchInput') as HTMLInputElement).value.trim()) runSearch();
}

/* ================= Settlement (사용 기준 · 익월 25일) ================= */
const typeBadgeByType = (t: string) => TYPE_BADGE[t] || TYPE_BADGE.service;

function renderSettlement() {
  // 정산은 사용처리 지점 귀속 → 계정 스코프 지점의 라인만
  const ids = allowedIds();
  const lines = settleLines(coupons).filter((l) => ids.has(l.branchId));
  const totalSettle = lines.reduce((s, l) => s + l.settle, 0);
  const doneSum = lines.filter((l) => l.payout <= today).reduce((s, l) => s + l.settle, 0);
  const pendingSum = lines.filter((l) => l.payout > today).reduce((s, l) => s + l.settle, 0);

  // 다음 지급일 = 익월 25일 (그 전월 사용분)
  const nextDate = new Date(today.getFullYear(), today.getMonth() + 1, PAYOUT_DAY);
  const nd = ymd(nextDate);
  const um = new Date(nextDate.getFullYear(), nextDate.getMonth() - 1, 1);
  const umLabel = `${um.getFullYear()}.${String(um.getMonth() + 1).padStart(2, '0')}`;
  const nextLines = lines.filter((l) => ymd(l.payout) === nd);
  const nextSum = nextLines.reduce((s, l) => s + l.settle, 0);

  $('settleStats').innerHTML = `
    <div class="stat accent"><div class="lbl">다음 정산 (${nd})</div><div class="num">${won(nextSum)}<small> 원</small></div><div class="sub2">${umLabel} 사용분</div></div>
    <div class="stat green"><div class="lbl">정산 완료</div><div class="num">${won(doneSum)}<small> 원</small></div><div class="sub2">지급 완료 누계</div></div>
    <div class="stat"><div class="lbl">정산 예정</div><div class="num">${won(pendingSum)}<small> 원</small></div><div class="sub2">지급 대기</div></div>
    <div class="stat gold"><div class="lbl">정산 누계</div><div class="num">${won(totalSettle)}<small> 원</small></div><div class="sub2">사용 기준 합계</div></div>`;

  $('nextPayTitle').textContent = `다음 정산 예정 — ${nd} 지급`;
  $('settleSummary').innerHTML = `
    <div class="ledger"><span class="k">정산 대상 사용월</span><span class="v">${umLabel} (1일~말일)</span></div>
    <div class="ledger"><span class="k">정산 대상 건수</span><span class="v">${nextLines.length}건</span></div>
    <div class="ledger total"><span class="k">${nd} 지급 예정액</span><span class="v">${won(nextSum)}원</span></div>`;

  // 정산주체별 지급 — 직영점 사용분은 본사 합산, 가맹점 사용분은 각자 지급
  const groups = groupByPayee(nextLines);
  $('payeeSummary').innerHTML = groups.length
    ? `<table><thead><tr>
        <th>정산주체(사업자)</th><th>구분</th><th>사용 지점</th><th class="num">건수</th><th class="num">${nd} 지급액</th>
        </tr></thead><tbody>${groups.map((g) => `<tr>
          <td><b>${g.payee}</b></td>
          <td>${g.kind === 'direct' ? '<span class="badge ok">직영 · 본사 합산</span>' : '<span class="badge amount">가맹 · 개별 지급</span>'}</td>
          <td>${g.branchNames.join(', ')}</td>
          <td class="num">${g.count}건</td>
          <td class="num"><b>${won(g.total)}원</b></td>
        </tr>`).join('')}</tbody></table>`
    : `<p class="desc">다음 지급일에 지급될 사용분이 아직 없습니다.</p>`;

  if (!lines.length) {
    $('settleList').innerHTML = `<div class="no-result"><div class="ico">₩</div><div class="lead">정산 대상 사용 내역이 없어요.</div>쿠폰이 사용처리·차감되면 정산 대상이 됩니다.</div>`;
    return;
  }
  const list = lines.map((l) => `<tr>
      <td style="white-space:nowrap">${l.usedAt}</td>
      <td class="code">${l.code}<div class="pname" style="font-weight:400">${l.product}</div></td>
      <td>${typeBadgeByType(l.type)}</td>
      <td style="white-space:nowrap">${branchLabel(l.branchId)}</td>
      <td class="num">${l.type === 'count' ? `${l.usedAmount}회` : won(l.usedAmount)}</td>
      <td class="num"><b>${won(l.settle)}</b></td>
      <td style="white-space:nowrap">${ymd(l.payout)}</td>
      <td>${l.payout <= today ? '<span class="badge used">지급완료</span>' : '<span class="badge info">지급예정</span>'}</td>
    </tr>`).join('');
  $('settleList').innerHTML = `<table><thead><tr>
    <th>사용일시</th><th>쿠폰 / 상품</th><th>유형</th><th>사용 지점</th><th class="num">사용액</th><th class="num">정산액</th><th>지급일</th><th>상태</th>
    </tr></thead><tbody>${list}</tbody></table>`;
}

/* ================= Contact (mailto) ================= */
$('contactForm').onsubmit = async (e) => {
  e.preventDefault();
  const category = ($('ctCat') as HTMLSelectElement).value;
  const phone = ($('ctPhone') as HTMLInputElement).value.trim();
  const subject = ($('ctSubject') as HTMLInputElement).value.trim();
  const body = ($('ctBody') as HTMLTextAreaElement).value.trim();
  if (!subject || !body) { toast('⚠️ 제목과 내용을 입력하세요'); return; }
  const url = await api.sendInquiry({ category, phone, subject, body });
  window.location.href = url;
  toast('✉ 메일 작성창을 열었어요');
};

/* ================= Guide subnav ================= */
$('guideNav').onclick = (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLElement;
  if (!b) return;
  document.querySelectorAll('#guideNav button').forEach((x) => x.classList.remove('on'));
  b.classList.add('on');
  document.querySelectorAll('#view-guide .doc').forEach((d) => d.classList.remove('show'));
  $('doc-' + b.dataset.doc).classList.add('show');
};

/* ================= 알림 문자 이력 ================= */
async function renderSms() {
  const list = await api.listSms();
  const box = $('smsList');
  if (!list.length) {
    box.innerHTML = `<div class="no-result"><div class="ico">💬</div><div class="lead">발송된 문자가 없어요.</div>쿠폰을 사용처리하면 고객에게 알림 문자가 발송됩니다.</div>`;
    return;
  }
  const kindBadge = (k: string) =>
    k === 'used-up' ? '<span class="badge exp">잔액 소진</span>' : k === 'deduct' ? '<span class="badge amount">차감</span>' : '<span class="badge ok">사용처리</span>';
  box.innerHTML = `<table><thead><tr>
    <th>발송일시</th><th class="col-hide">고객 연락처</th><th>구분</th><th>문자 내용</th>
    </tr></thead><tbody>${list.map((s) => `<tr>
      <td style="white-space:nowrap">${s.at}</td>
      <td class="col-hide" style="white-space:nowrap">${s.phone}</td>
      <td>${kindBadge(s.kind)}</td>
      <td style="color:var(--ink-soft);line-height:1.6">${s.message}</td>
    </tr>`).join('')}</tbody></table>`;
}

/* ================= 정산 명세서 ================= */
function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function renderStatements() {
  const ids = allowedIds();
  const lines = settleLines(coupons).filter((l) => ids.has(l.branchId));
  type Item = { usedAt: string; code: string; product: string; branch: string; usedAmount: number; settle: number };
  type Stmt = { key: string; date: string; payee: string; kind: 'direct' | 'franchise'; total: number; usolMonth: string; items: Item[] };
  // 명세서는 지급 단위 = (지급일 × 정산주체) — 직영은 본사 1건 합산, 가맹은 각자 1건
  const map = new Map<string, Stmt>();
  for (const l of lines) {
    const d = ymd(l.payout);
    const b = branchOf(l.branchId);
    const key = `${d}|${b.payee}`;
    const um = new Date(l.payout.getFullYear(), l.payout.getMonth() - 1, 1);
    const umLabel = `${um.getFullYear()}.${String(um.getMonth() + 1).padStart(2, '0')}`;
    const e = map.get(key) || { key, date: d, payee: b.payee, kind: b.kind, total: 0, usolMonth: umLabel, items: [] };
    e.total += l.settle;
    e.items.push({ usedAt: l.usedAt, code: l.code, product: l.product, branch: b.name, usedAmount: l.usedAmount, settle: l.settle });
    map.set(key, e);
  }
  const stmts = [...map.values()].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.kind === b.kind ? b.total - a.total : a.kind === 'direct' ? -1 : 1));
  const box = $('stmtList');
  if (!stmts.length) {
    box.innerHTML = `<div class="no-result"><div class="ico">🧾</div><div class="lead">정산 내역이 없어요.</div></div>`;
    return;
  }
  box.innerHTML = `<table><thead><tr>
    <th>지급일</th><th>정산주체(사업자)</th><th>사용월</th><th class="num">건수</th><th class="num">정산액</th><th>상태</th><th>문서</th>
    </tr></thead><tbody>${stmts.map((m) => {
      const paid = new Date(m.date) <= today;
      return `<tr>
        <td class="code">${m.date}</td>
        <td><b>${m.payee}</b><div style="color:var(--sub);font-size:var(--fs-cap)">${m.kind === 'direct' ? '직영 · 본사 합산' : '가맹 · 개별 지급'}</div></td>
        <td>${m.usolMonth}</td>
        <td class="num">${m.items.length}건</td>
        <td class="num"><b>${won(m.total)}</b></td>
        <td>${paid ? '<span class="badge used">지급완료</span>' : '<span class="badge info">지급예정</span>'}</td>
        <td style="white-space:nowrap"><button class="btn-mini ghost stmt-dl" data-key="${m.key}">명세서</button> <button class="btn-mini ghost stmt-tax" data-key="${m.key}">세금계산서</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  box.querySelectorAll('.stmt-dl').forEach((b) => ((b as HTMLElement).onclick = () => {
    const m = map.get((b as HTMLElement).dataset.key!)!;
    const head = ['지급일', '정산주체', '사용일시', '쿠폰번호', '상품', '사용 지점', '사용액', '정산액'];
    const rows = [head, ...m.items.map((it) => [m.date, m.payee, it.usedAt, it.code, it.product, it.branch, String(it.usedAmount), String(it.settle)])];
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`바른라운지_정산명세서_${m.date}_${m.payee}.csv`, csv);
    toast('명세서를 내려받았어요');
  }));
  box.querySelectorAll('.stmt-tax').forEach((b) => ((b as HTMLElement).onclick = () => toast('세금계산서는 정산 확정 후 정산주체(사업자)별로 발행됩니다')));
}

/* ================= 업체·정산 정보 ================= */
function renderSettings() {
  const p = user?.profile || {};
  const v = (x?: string) => (x ? x.replace(/"/g, '&quot;') : '');
  $('settingsPanel').innerHTML = `
    <h2>정산 계좌</h2>
    <p class="desc">정산 대금이 이 계좌로 매월 25일 입금됩니다. 다지점 브랜드는 정산주체(본사·각 가맹점)별로 계좌를 등록합니다.</p>
    <form id="settingsForm">
      <div class="form-grid">
        <div class="field"><label>은행</label><input id="seBank" type="text" placeholder="예: 국민은행" value="${v(p.bank)}" /></div>
        <div class="field"><label>계좌번호</label><input id="seAccount" type="text" placeholder="- 없이 입력" value="${v(p.account)}" /></div>
        <div class="field full"><label>예금주</label><input id="seHolder" type="text" placeholder="예: (주)더마린" value="${v(p.holder)}" /></div>
      </div>
      <h2 style="margin-top:var(--sp-7)">세금계산서 정보</h2>
      <p class="desc">세금계산서 발행에 사용됩니다.</p>
      <div class="form-grid">
        <div class="field"><label>상호</label><input id="seCompany" type="text" value="${v(p.company || user?.vendorName)}" /></div>
        <div class="field"><label>대표자</label><input id="seCeo" type="text" value="${v(p.ceo)}" /></div>
        <div class="field"><label>사업자등록번호</label><input type="text" value="${v(user?.bizNo)}" disabled /></div>
        <div class="field"><label>담당자 연락처</label><input id="sePhone" type="text" placeholder="010-0000-0000" value="${v(p.phone || user?.phone)}" /></div>
        <div class="field"><label>업태</label><input id="seBizType" type="text" placeholder="예: 서비스" value="${v(p.bizType)}" /></div>
        <div class="field"><label>종목</label><input id="seBizItem" type="text" placeholder="예: 피부미용" value="${v(p.bizItem)}" /></div>
        <div class="field full"><label>사업장 주소</label><input id="seAddr" type="text" value="${v(p.addr)}" /></div>
        <div class="field full"><label>세금계산서 이메일</label><input id="seTaxEmail" type="email" placeholder="tax@example.com" value="${v(p.taxEmail)}" /></div>
      </div>
      <button class="btn-primary" type="submit" style="margin-top:var(--sp-5);max-width:280px">저장</button>
    </form>`;
  $('settingsForm').onsubmit = async (e) => {
    e.preventDefault();
    const g = (id: string) => ($(id) as HTMLInputElement).value.trim();
    user = await auth.updateProfile({
      bank: g('seBank'), account: g('seAccount'), holder: g('seHolder'),
      company: g('seCompany'), ceo: g('seCeo'), bizType: g('seBizType'), bizItem: g('seBizItem'),
      addr: g('seAddr'), taxEmail: g('seTaxEmail'), phone: g('sePhone'),
    });
    toast('✓ 저장되었어요');
  };
}

/* ================= 공지사항 ================= */
async function renderNotice() {
  const list = await api.listNotices();
  $('noticeList').innerHTML = list.map((n) => `
    <div class="notice ${n.pinned ? 'pinned' : ''}">
      <div class="notice-top"><span class="notice-title">${n.pinned ? '📌 ' : ''}${n.title}</span><span class="notice-date">${n.date}</span></div>
      <p class="notice-body">${n.body}</p>
    </div>`).join('');
}

/* ================= Toast ================= */
let toastTimer: number | undefined;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2400);
}

/* ================= 세션 복원 ================= */
user = auth.current();
if (user) enterApp();
