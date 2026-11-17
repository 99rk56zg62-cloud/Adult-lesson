import { DateTime } from "luxon";
import { ZONE } from "./time.js";

export const DEPOSIT_RATIO = 0.2;
export const BALANCE_LEAD_DAYS = 28;
export const BALANCE_REMINDER_DAYS = 7;

export type CoursePaymentPlan = {
  packagePence: number;
  depositPence: number;
  balancePence: number;
  payTodayPence: number;
  dueAt: DateTime | null;
  fullUpfront: boolean;
};

export function coursePaymentPlan(packagePence: number, firstStartsAt: DateTime, bookedAt: DateTime): CoursePaymentPlan {
  const dueAt = firstStartsAt.setZone(ZONE).startOf("day").minus({ days: BALANCE_LEAD_DAYS });
  if (dueAt.toMillis() <= bookedAt.toMillis()) {
    return {
      packagePence,
      depositPence: packagePence,
      balancePence: 0,
      payTodayPence: packagePence,
      dueAt: null,
      fullUpfront: true,
    };
  }
  const depositPence = Math.round(packagePence * DEPOSIT_RATIO);
  const balancePence = packagePence - depositPence;
  return {
    packagePence,
    depositPence,
    balancePence,
    payTodayPence: depositPence,
    dueAt,
    fullUpfront: false,
  };
}
