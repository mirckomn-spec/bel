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

/** Comissao marginal: so o que passa da meta diaria usa a % da meta. */
export function computeMarginalCommissionEarnings(
  cumulativeBefore: number,
  saleAmount: number,
  commissions: ResolvedCommissionPercents,
  dailyTarget = DAILY_SALES_TARGET,
) {
  const amount = Math.max(0, Number(saleAmount));
  if (amount <= 0) return 0;

  const before = Math.max(0, Number(cumulativeBefore));
  const after = before + amount;

  if (before >= dailyTarget) {
    return amount * (commissions.goalReached / 100);
  }
  if (after <= dailyTarget) {
    return amount * (commissions.global / 100);
  }

  const atGlobalRate = dailyTarget - before;
  const atGoalRate = amount - atGlobalRate;
  return (
    atGlobalRate * (commissions.global / 100) + atGoalRate * (commissions.goalReached / 100)
  );
}

export function proofGrossSaleValue(proof: ProofCommissionInput) {
  return Number(proof.grossSaleValue ?? proof.saleValue ?? 0);
}

export function proofNetSaleValue(proof: ProofCommissionInput) {
  return Number(proof.saleValue ?? 0);
}

function proofSortTime(proof: ProofCommissionInput) {
  const time = new Date(proof.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function proofTrackingKey(proof: ProofCommissionInput, index: number) {
  return `${String(proof.uploader ?? "").toLowerCase()}|${dayKeyFromDate(proof.createdAt)}|${proofSortTime(proof)}|${proofNetSaleValue(proof)}|${index}`;
}

function filterProofsForUser(username: string, proofs: ProofCommissionInput[]) {
  const normalized = username.toLowerCase();
  return proofs.filter((proof) => String(proof.uploader ?? "").toLowerCase() === normalized);
}

/** Mapa proofKey -> vendas acumuladas no dia ANTES deste comprovante. */
export function buildCumulativeBeforeByProof(
  username: string,
  proofs: ProofCommissionInput[],
) {
  const userProofs = filterProofsForUser(username, proofs).sort(
    (a, b) => proofSortTime(a) - proofSortTime(b),
  );
  const cumulativeBefore = new Map<string, number>();
  const dayRunning = new Map<string, number>();

  userProofs.forEach((proof, index) => {
    const day = dayKeyFromDate(proof.createdAt);
    const before = dayRunning.get(day) ?? 0;
    cumulativeBefore.set(proofTrackingKey(proof, index), before);
    dayRunning.set(day, before + proofNetSaleValue(proof));
  });

  return { cumulativeBefore, userProofs };
}

export function computeProofCommissionEarnings(
  proof: ProofCommissionInput,
  cumulativeBeforeSameDay: number,
  control?: CommissionControlInput | null,
  dailyTarget = DAILY_SALES_TARGET,
) {
  const commissions = resolveCommissionPercents(control);
  return computeMarginalCommissionEarnings(
    cumulativeBeforeSameDay,
    proofNetSaleValue(proof),
    commissions,
    dailyTarget,
  );
}

export function computeEarningsFromProofs(
  username: string,
  proofs: ProofCommissionInput[],
  control?: CommissionControlInput | null,
  dailyTarget = DAILY_SALES_TARGET,
) {
  const commissions = resolveCommissionPercents(control);
  const { cumulativeBefore, userProofs } = buildCumulativeBeforeByProof(username, proofs);

  let grossReal = 0;
  userProofs.forEach((proof, index) => {
    const before = cumulativeBefore.get(proofTrackingKey(proof, index)) ?? 0;
    grossReal += computeMarginalCommissionEarnings(
      before,
      proofNetSaleValue(proof),
      commissions,
      dailyTarget,
    );
  });

  const todaySummary = computeDayCommissionSummary(
    username,
    proofs,
    control,
    new Date().toISOString().slice(0, 10),
    dailyTarget,
  );

  return {
    grossReal: Number(grossReal.toFixed(2)),
    commissionPercentToday: todaySummary.effectivePercent,
    nextSaleCommissionPercent: todaySummary.nextSalePercent,
    metaReachedToday: todaySummary.metaReached,
    commissions,
  };
}

export function computeDayCommissionSummary(
  username: string,
  proofs: ProofCommissionInput[],
  control: CommissionControlInput | null | undefined,
  dayKey: string,
  dailyTarget = DAILY_SALES_TARGET,
) {
  const commissions = resolveCommissionPercents(control);
  const { cumulativeBefore, userProofs } = buildCumulativeBeforeByProof(username, proofs);

  let sales = 0;
  let earnings = 0;
  userProofs.forEach((proof, index) => {
    if (dayKeyFromDate(proof.createdAt) !== dayKey) return;
    const before = cumulativeBefore.get(proofTrackingKey(proof, index)) ?? 0;
    const amount = proofNetSaleValue(proof);
    earnings += computeMarginalCommissionEarnings(before, amount, commissions, dailyTarget);
    sales += amount;
  });

  const metaReached = sales >= dailyTarget;
  const effectivePercent =
    sales > 0 ? Number(((earnings / sales) * 100).toFixed(2)) : commissions.global;
  const nextSalePercent = metaReached ? commissions.goalReached : commissions.global;

  return {
    sales: Number(sales.toFixed(2)),
    earnings: Number(earnings.toFixed(2)),
    effectivePercent,
    nextSalePercent,
    metaReached,
  };
}

export function computeTodayCommissionPercentForUser(
  username: string,
  proofs: ProofCommissionInput[],
  control?: CommissionControlInput | null,
  dailyTarget = DAILY_SALES_TARGET,
) {
  const today = new Date().toISOString().slice(0, 10);
  return computeDayCommissionSummary(username, proofs, control, today, dailyTarget)
    .effectivePercent;
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
    totals.set(day, (totals.get(day) ?? 0) + proofNetSaleValue(proof));
  }
  return totals;
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
  const { cumulativeBefore, userProofs } = buildCumulativeBeforeByProof(username, proofs);
  const commissions = resolveCommissionPercents(control);

  let grossSold = 0;
  let netSold = 0;
  let realEarnings = 0;
  let proofCount = 0;

  userProofs.forEach((proof, index) => {
    const created = new Date(proof.createdAt).getTime();
    if (Number.isNaN(created)) return;
    if (sinceMs != null && created <= sinceMs) return;
    if (untilMs != null && created > untilMs) return;

    const gross = proofGrossSaleValue(proof);
    const net = proofNetSaleValue(proof);
    const before = cumulativeBefore.get(proofTrackingKey(proof, index)) ?? 0;

    grossSold += gross;
    netSold += net;
    realEarnings += computeMarginalCommissionEarnings(
      before,
      net,
      commissions,
      DAILY_SALES_TARGET,
    );
    proofCount += 1;
  });

  return {
    grossSold: Number(grossSold.toFixed(2)),
    netSold: Number(netSold.toFixed(2)),
    realEarnings: Number(realEarnings.toFixed(2)),
    proofCount,
  };
}

/** @deprecated Use meta marginal — mantido so para compatibilidade interna. */
export function commissionPercentForDayTotal(
  dayTotal: number,
  commissions: ResolvedCommissionPercents,
  dailyTarget = DAILY_SALES_TARGET,
) {
  return dayTotal >= dailyTarget ? commissions.goalReached : commissions.global;
}
