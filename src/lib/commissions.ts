export const DAILY_SALES_TARGET = 150;

export const DEFAULT_GLOBAL_COMMISSION_PERCENT = 35;
export const DEFAULT_GOAL_REACHED_COMMISSION_PERCENT = 40;

export type CommissionControlInput = {
  commissionPercentOverride?: number | null;
  globalCommissionPercentOverride?: number | null;
  goalReachedCommissionPercentOverride?: number | null;
};

export type ResolvedCommissionPercents = {
  global: number;
  goalReached: number;
};

export type ProofCommissionInput = {
  uploader?: string;
  saleValue?: number;
  grossSaleValue?: number;
  createdAt: string | Date;
};

export function dayKeyFromDate(dateInput: string | Date) {
  return new Date(dateInput).toISOString().slice(0, 10);
}

export function resolveCommissionPercents(
  control?: CommissionControlInput | null,
): ResolvedCommissionPercents {
  const legacy = control?.commissionPercentOverride;
  const global =
    control?.globalCommissionPercentOverride != null
      ? Number(control.globalCommissionPercentOverride)
      : legacy != null
        ? Number(legacy)
        : DEFAULT_GLOBAL_COMMISSION_PERCENT;
  const goalReached =
    control?.goalReachedCommissionPercentOverride != null
      ? Number(control.goalReachedCommissionPercentOverride)
      : legacy != null
        ? Number(legacy)
        : DEFAULT_GOAL_REACHED_COMMISSION_PERCENT;
  return {
    global: Math.min(100, Math.max(0, global)),
    goalReached: Math.min(100, Math.max(0, goalReached)),
  };
}

export function commissionPercentForDayTotal(
  dayTotal: number,
  commissions: ResolvedCommissionPercents,
  dailyTarget = DAILY_SALES_TARGET,
) {
  return dayTotal >= dailyTarget ? commissions.goalReached : commissions.global;
}

export function buildDailyTotalsForUser(
  username: string,
  proofs: ProofCommissionInput[],
) {
  const normalized = username.toLowerCase();
  const totals = new Map<string, number>();
  for (const proof of proofs) {
    if (String(proof.uploader ?? "").toLowerCase() !== normalized) continue;
    const day = dayKeyFromDate(proof.createdAt);
    totals.set(day, (totals.get(day) ?? 0) + Number(proof.saleValue ?? 0));
  }
  return totals;
}

export function computeTodayCommissionPercentForUser(
  username: string,
  proofs: ProofCommissionInput[],
  control?: CommissionControlInput | null,
  dailyTarget = DAILY_SALES_TARGET,
) {
  const commissions = resolveCommissionPercents(control);
  const today = new Date().toISOString().slice(0, 10);
  const todayTotal = buildDailyTotalsForUser(username, proofs).get(today) ?? 0;
  return commissionPercentForDayTotal(todayTotal, commissions, dailyTarget);
}

export function computeEarningsFromProofs(
  username: string,
  proofs: ProofCommissionInput[],
  control?: CommissionControlInput | null,
  dailyTarget = DAILY_SALES_TARGET,
) {
  const commissions = resolveCommissionPercents(control);
  const normalized = username.toLowerCase();
  const dailyTotals = buildDailyTotalsForUser(username, proofs);
  let grossReal = 0;

  for (const proof of proofs) {
    if (String(proof.uploader ?? "").toLowerCase() !== normalized) continue;
    const day = dayKeyFromDate(proof.createdAt);
    const dayTotal = dailyTotals.get(day) ?? 0;
    const percent = commissionPercentForDayTotal(dayTotal, commissions, dailyTarget);
    grossReal += Number(proof.saleValue ?? 0) * (percent / 100);
  }

  const today = new Date().toISOString().slice(0, 10);
  const commissionPercentToday = commissionPercentForDayTotal(
    dailyTotals.get(today) ?? 0,
    commissions,
    dailyTarget,
  );

  return {
    grossReal: Number(grossReal.toFixed(2)),
    commissionPercentToday,
    commissions,
  };
}

export function proofGrossSaleValue(proof: ProofCommissionInput) {
  return Number(proof.grossSaleValue ?? proof.saleValue ?? 0);
}

export function proofNetSaleValue(proof: ProofCommissionInput) {
  return Number(proof.saleValue ?? 0);
}

export function computePeriodTotals(
  username: string,
  proofs: ProofCommissionInput[],
  control: CommissionControlInput | null | undefined,
  options: {
    sinceMs?: number;
    untilMs?: number;
  } = {},
) {
  const normalized = username.toLowerCase();
  const { sinceMs, untilMs } = options;
  const filtered = proofs.filter((proof) => {
    if (String(proof.uploader ?? "").toLowerCase() !== normalized) return false;
    const created = new Date(proof.createdAt).getTime();
    if (Number.isNaN(created)) return false;
    if (sinceMs != null && created <= sinceMs) return false;
    if (untilMs != null && created > untilMs) return false;
    return true;
  });

  const dailyTotals = buildDailyTotalsForUser(username, proofs);
  const commissions = resolveCommissionPercents(control);
  let grossSold = 0;
  let netSold = 0;
  let realEarnings = 0;

  for (const proof of filtered) {
    const gross = proofGrossSaleValue(proof);
    const net = proofNetSaleValue(proof);
    grossSold += gross;
    netSold += net;
    const day = dayKeyFromDate(proof.createdAt);
    const percent = commissionPercentForDayTotal(
      dailyTotals.get(day) ?? 0,
      commissions,
    );
    realEarnings += net * (percent / 100);
  }

  return {
    grossSold: Number(grossSold.toFixed(2)),
    netSold: Number(netSold.toFixed(2)),
    realEarnings: Number(realEarnings.toFixed(2)),
    proofCount: filtered.length,
  };
}
