import "server-only";
import type { Db } from "mongodb";
import {
  computeEarningsFromProofs,
  computeTodayCommissionPercentForUser,
  type CommissionControlInput,
} from "@/lib/commissions";
import { getInviteesByInviter, getReferralBonusPercent } from "@/lib/referrals";

type ProofDoc = {
  uploader?: string;
  saleValue?: number;
  grossSaleValue?: number;
  createdAt: string | Date;
};

type WithdrawalDoc = {
  username: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
};

export type WalletSnapshot = {
  commissionPercent: number;
  balanceAdjustment: number;
  referralBonusAmount: number;
  approvedTotal: number;
  grossReal: number;
  available: number;
};

function controlFromOptions(options?: {
  globalCommissionPercentOverride?: number | null;
  goalReachedCommissionPercentOverride?: number | null;
  legacyCommissionPercentOverride?: number | null;
}): CommissionControlInput {
  return {
    commissionPercentOverride: options?.legacyCommissionPercentOverride ?? null,
    globalCommissionPercentOverride: options?.globalCommissionPercentOverride ?? null,
    goalReachedCommissionPercentOverride:
      options?.goalReachedCommissionPercentOverride ?? null,
  };
}

export { computeTodayCommissionPercentForUser };

export function computeAvailableFromProofsAndWithdrawals(
  username: string,
  proofs: ProofDoc[],
  withdrawals: WithdrawalDoc[],
  options?: {
    globalCommissionPercentOverride?: number | null;
    goalReachedCommissionPercentOverride?: number | null;
    legacyCommissionPercentOverride?: number | null;
    balanceAdjustment?: number;
    referralBonusAmount?: number;
  },
): WalletSnapshot {
  const control = controlFromOptions(options);
  const { grossReal, commissionPercentToday } = computeEarningsFromProofs(
    username,
    proofs,
    control,
  );
  const approvedTotal = withdrawals
    .filter(
      (w) => String(w.username ?? "").toLowerCase() === username && w.status === "approved",
    )
    .reduce((acc, w) => acc + Number(w.amount ?? 0), 0);
  const balanceAdjustment = Number(options?.balanceAdjustment ?? 0);
  const referralBonusAmount = Number(options?.referralBonusAmount ?? 0);
  return {
    commissionPercent: commissionPercentToday,
    balanceAdjustment: Number(balanceAdjustment.toFixed(2)),
    referralBonusAmount: Number(referralBonusAmount.toFixed(2)),
    approvedTotal: Number(approvedTotal.toFixed(2)),
    grossReal,
    available: Number(
      Math.max(0, grossReal + referralBonusAmount - approvedTotal + balanceAdjustment).toFixed(2),
    ),
  };
}

export async function loadReferralBonusForUser(
  db: Db,
  username: string,
  proofs: ProofDoc[],
): Promise<number> {
  const invitees = await getInviteesByInviter(db, username);
  if (invitees.length === 0) return 0;
  const inviteeSet = new Set(invitees.map((i) => i.inviteeUsername));
  const invitedTotal = proofs
    .filter((proof) => inviteeSet.has(String(proof.uploader ?? "").toLowerCase()))
    .reduce((acc, proof) => acc + Number(proof.saleValue ?? 0), 0);
  const bonusPercent = await getReferralBonusPercent(db);
  return Number((invitedTotal * (bonusPercent / 100)).toFixed(2));
}

export function computeBalanceAdjustmentForTarget(
  snapshot: Pick<WalletSnapshot, "grossReal" | "referralBonusAmount" | "approvedTotal">,
  targetAvailable: number,
): number {
  const target = Math.max(0, Number(targetAvailable));
  const adjustment =
    target - snapshot.grossReal - snapshot.referralBonusAmount + snapshot.approvedTotal;
  return Number(adjustment.toFixed(2));
}
