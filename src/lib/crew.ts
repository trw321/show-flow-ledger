import type { CrewMember, CrewShift } from './store';
import { calcHours } from './hoursMatching';
import { localToday } from './today';

/**
 * The hours on a crew shift: what they worked, once it is in — until then the
 * call and wrap times stand in, so a schedule already says what it will cost.
 */
export function crewShiftHours(shift: CrewShift): number {
  if (shift.hoursWorked && shift.hoursWorked > 0) return shift.hoursWorked;
  if (!shift.startTime || !shift.endTime) return 0;
  return Math.round(calcHours(shift.startTime, shift.endTime) * 100) / 100;
}

/** What you pay for the shift: this shift's rate if it has one, else theirs. */
export function crewShiftPay(shift: CrewShift, member?: CrewMember): number {
  const rate = shift.rate ?? member?.payRate ?? 0;
  return Math.round(crewShiftHours(shift) * rate * 100) / 100;
}

/** What you bill a client for the shift: their bill rate, else what you pay them. */
export function crewShiftBillRate(shift: CrewShift, member?: CrewMember): number {
  return member?.billRate ?? shift.rate ?? member?.payRate ?? 0;
}

/** Worked: its day has come and gone. Only then is it owed. */
export function crewShiftWorked(shift: CrewShift, today = localToday()): boolean {
  return shift.date <= today && crewShiftHours(shift) > 0;
}

/** Worked and not yet paid — what you owe. */
export function crewShiftOwed(shift: CrewShift, today = localToday()): boolean {
  return crewShiftWorked(shift, today) && !shift.payoutId;
}
