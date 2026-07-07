// ===== 순수 도메인 로직 (잔액·상태·정산 계산) =====
import type { Coupon, CouponType, BranchKind } from './types';
import { todayStr, PAYOUT_DAY, branchOf } from './config';

/** 잔여량 — 금액형: 잔액(원) / 다회권: 잔여 회수 / 일반 쿠폰: 0 */
export function balanceOf(c: Coupon): number {
  return c.type === 'amount' || c.type === 'count' ? Math.max(0, (c.face || 0) - (c.used || 0)) : 0;
}

/** 만료/사용 등을 반영한 실제 상태 */
export function realStatus(c: Coupon): 'available' | 'used' | 'expired' | 'refunded' {
  if (c.status === 'refunded') return 'refunded';
  if ((c.type === 'amount' || c.type === 'count') && balanceOf(c) <= 0) return 'used';
  if (c.status === 'used') return 'used';
  if (new Date(c.expire) < new Date(todayStr)) return 'expired';
  return 'available';
}

export const STATUS_META: Record<string, { cls: string; txt: string; ic: string }> = {
  available: { cls: 'ok', txt: '사용가능', ic: '●' },
  used: { cls: 'used', txt: '사용완료', ic: '✓' },
  expired: { cls: 'exp', txt: '기간만료', ic: '⦸' },
  refunded: { cls: 'info', txt: '환불완료', ic: '↩' },
};

/** 일반 쿠폰 할인율(%) */
export function discPct(c: Coupon): number {
  return c.origin && c.origin > c.paid ? Math.round((1 - c.paid / c.origin) * 100) : 0;
}

/** 만료된 자유이용권·다회권의 미사용 잔여분 → 환불 대상액(결제액 비례 90%) */
export function refundDue(c: Coupon): number {
  if (c.type !== 'amount' && c.type !== 'count') return 0;
  if (realStatus(c) !== 'expired') return 0;
  const unused = balanceOf(c); // 금액형: 잔액 / 다회권: 잔여 회수
  if (unused <= 0) return 0;
  return Math.round(c.paid * (unused / (c.face || 1)) * 0.9);
}

/** 사용일이 속한 달의 익월 PAYOUT_DAY일 (지급일) */
export function payoutDate(dateStr: string): Date {
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth() + 1, PAYOUT_DAY);
}

/** 정산 라인 — 사용(사용처리·차감) 1건 = 정산 1건 */
export interface SettleLine {
  code: string;
  product: string;
  type: CouponType;
  usedAt: string;      // 사용/차감 일시
  usedAmount: number;  // 일반: 판매가 / 자유이용권: 차감 액면
  settle: number;      // 실제 정산액
  payout: Date;        // 지급일(사용월 익월 25일)
  branchId: string;    // 사용처리한 지점 — 정산 귀속 기준
}

/**
 * 사용 기준 정산 라인 계산.
 * - 일반 쿠폰: 사용처리 시 판매가 전액을, 사용월 익월 25일에 지급.
 * - 자유이용권: 차감할 때마다 (차감 액면 × 결제액/액면)을, 차감월 익월 25일에 지급.
 * - 다회권: 사용 회수 × 회당 균등 단가(결제액 ÷ 총 회수). 마지막 회차에서 끝수 보정
 *   (정산 누계가 정확히 결제액이 되도록 잔액 정산) — 회당 반올림 오차 방지.
 * 미사용분은 정산 대상이 아니다(쓴 만큼만 정산).
 * 각 라인은 "사용처리한 지점"에 귀속된다(구매 지점 아님).
 */
export function settleLines(coupons: Coupon[]): SettleLine[] {
  const lines: SettleLine[] = [];
  for (const c of coupons) {
    if (c.type === 'amount' || c.type === 'count') {
      const unit = c.face ? c.paid / c.face : 0; // 금액형: 원당 비율 / 다회권: 회당 단가
      let cumUse = 0, cumSettle = 0;
      for (const h of c.history || []) {
        cumUse += h.amount;
        // 완주(총량 소진) 시 마지막 라인은 잔액으로 보정해 합계 = 결제액
        const settle = cumUse >= (c.face || 0) ? c.paid - cumSettle : Math.round(h.amount * unit);
        cumSettle += settle;
        lines.push({
          code: c.code, product: c.product, type: c.type,
          usedAt: h.date, usedAmount: h.amount, settle,
          payout: payoutDate(h.date),
          branchId: branchOf(h.branchId || c.branchId).id,
        });
      }
    } else if (realStatus(c) === 'used' && c.usedAt) {
      lines.push({
        code: c.code, product: c.product, type: c.type,
        usedAt: c.usedAt, usedAmount: c.paid, settle: c.paid,
        payout: payoutDate(c.usedAt),
        branchId: branchOf(c.usedBranchId || c.branchId).id,
      });
    }
  }
  return lines.sort((a, b) => (a.usedAt < b.usedAt ? 1 : -1));
}

/** 정산주체(사업자)별 합산 — 직영점 사용분은 본사 1건으로 합산, 가맹점은 각자 1건 */
export interface PayeeGroup {
  payee: string;         // 정산주체(사업자)
  kind: BranchKind;
  branchNames: string[]; // 이 정산주체에 귀속된 사용 지점들
  count: number;
  total: number;
}
export function groupByPayee(lines: SettleLine[]): PayeeGroup[] {
  const map = new Map<string, PayeeGroup>();
  for (const l of lines) {
    const b = branchOf(l.branchId);
    const g = map.get(b.payee) || { payee: b.payee, kind: b.kind, branchNames: [], count: 0, total: 0 };
    if (!g.branchNames.includes(b.name)) g.branchNames.push(b.name);
    g.count++;
    g.total += l.settle;
    map.set(b.payee, g);
  }
  // 직영(본사) 먼저, 이후 정산액 큰 순
  return [...map.values()].sort((a, b) => (a.kind === b.kind ? b.total - a.total : a.kind === 'direct' ? -1 : 1));
}
