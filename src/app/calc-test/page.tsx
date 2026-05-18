// src/app/calc-test/page.tsx
'use client';

import { useState } from 'react';
import { calculatePayBreakdown } from '@/lib/payroll/pay-breakdown';
import type { ContractSnapshot } from '@/types/contracts';
import type { GigFacts, ConsecutiveDayContext, GigPayBreakdown } from '@/lib/payroll/types';

// Hardcoded snapshot — Local 16 Basic Entertainment 2023-2028
// Mirrors the contract version row Taryn already entered in Supabase
const TEST_SNAPSHOT: ContractSnapshot = {
  snapshot_schema_version: 2,
  contract_version_id: 'test',
  contract_name: 'IATSE Local 16 Basic Entertainment Agreement',
  version_label: '2023-2028',
  effective_date: '2023-08-01',
  classification_name: null,
  classification_hourly_rate: null,
  classification_minimum_hours: null,
  rate_type: 'hourly',
  hourly_rate: 55.72,
  day_rate: null,
  flat_amount: null,
  overtime_tiers: [
    { after_hours: 8, multiplier: 1.5 },
    { after_hours: 12, multiplier: 2.0 },
  ],
  rounding: 'hour_up',
  minimum_call_hours: 5,
  meal_penalty_due_after_hours: 5,
  meal_penalty_rate_type: 'straight_time',
  meal_penalty_unit: 'hour',
  turnaround_minimum_hours: null,
  turnaround_violation_multiplier: null,
  fringe_percent: 8,
  fringe_in_check: true,
  forced_call_premium_amount: null,
  forced_call_premium_type: null,
  night_premium_start_hour: 0,
  night_premium_end_hour: 8,
  night_premium_multiplier: 2.0,
  consecutive_day_window_days: 7,
  consecutive_day_ot_threshold: 6,
  consecutive_day_ot_multiplier: 1.5,
  consecutive_day_dt_threshold: 7,
  consecutive_day_dt_multiplier: 2.0,
  consecutive_day_grouping: 'payroll_company',
  pay_schedule: 'weekly',
  pay_schedule_anchor_date: '2026-05-08',
  pay_delay_days: 7,
};

export default function CalcTestPage() {
  const [workedHours, setWorkedHours] = useState('10');
  const [startHour, setStartHour] = useState('16'); // 4pm
  const [rate, setRate] = useState('55.72');
  const [mealPenaltyHours, setMealPenaltyHours] = useState('2');
  const [isHead, setIsHead] = useState(false);
  const [isSplit, setIsSplit] = useState(false);
  const [priorDaysWorked, setPriorDaysWorked] = useState('0');
  const [result, setResult] = useState<GigPayBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runCalc() {
    setError(null);
    setResult(null);
    try {
      // Build a start time on today at the specified hour
      const workDate = new Date();
      workDate.setHours(0, 0, 0, 0);
      const startTime = new Date(workDate);
      startTime.setHours(parseInt(startHour), 0, 0, 0);

      const hours = parseFloat(workedHours);
      const endTime = new Date(startTime.getTime() + hours * 60 * 60 * 1000);

      const facts: GigFacts = {
        work_date: workDate,
        worked_hours: hours,
        start_time: startTime,
        end_time: endTime,
        break_minutes: 0,
        meals_on_clock: false,
        is_head: isHead,
        is_split: isSplit,
        minimum_hours_override: null,
        meal_penalty_hours: parseFloat(mealPenaltyHours) || 0,
        forced_call: false,
        offered_hourly_rate: parseFloat(rate),
        offered_day_rate: null,
        offered_flat_amount: null,
      };

      // Build prior_worked_dates from the count input
      const priorDays = parseInt(priorDaysWorked) || 0;
      const priorDates: Date[] = [];
      for (let i = 1; i <= priorDays; i++) {
        const d = new Date(workDate);
        d.setDate(d.getDate() - i);
        priorDates.push(d);
      }

      const context: ConsecutiveDayContext = {
        prior_worked_dates: priorDates,
      };

      const breakdown = calculatePayBreakdown(facts, TEST_SNAPSHOT, context);
      setResult(breakdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main style={{ maxWidth: '600px', margin: '2rem auto', padding: '1rem', fontFamily: 'system-ui' }}>
      <h1>Calc Engine Test</h1>
      <p style={{ color: '#666' }}>
        Hardcoded Local 16 contract. Enter values, see the math.
      </p>

      <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
        <label>
          Worked hours:{' '}
          <input
            type="number"
            step="0.25"
            value={workedHours}
            onChange={(e) => setWorkedHours(e.target.value)}
          />
        </label>

        <label>
          Start hour (0-23, e.g. 16 for 4pm):{' '}
          <input
            type="number"
            min="0"
            max="23"
            value={startHour}
            onChange={(e) => setStartHour(e.target.value)}
          />
        </label>

        <label>
          Offered hourly rate:{' '}
          <input
            type="number"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>

        <label>
          Meal penalty hours (0 if fed on time):{' '}
          <input
            type="number"
            step="0.25"
            value={mealPenaltyHours}
            onChange={(e) => setMealPenaltyHours(e.target.value)}
          />
        </label>

        <label>
          Prior consecutive days worked (in last 6 days):{' '}
          <input
            type="number"
            min="0"
            max="6"
            value={priorDaysWorked}
            onChange={(e) => setPriorDaysWorked(e.target.value)}
          />
        </label>

        <label>
          <input
            type="checkbox"
            checked={isHead}
            onChange={(e) => setIsHead(e.target.checked)}
          />
          {' '}Is head/lead (8hr minimum)
        </label>

        <label>
          <input
            type="checkbox"
            checked={isSplit}
            onChange={(e) => setIsSplit(e.target.checked)}
          />
          {' '}Is split shift (4hr minimum)
        </label>

        <button
          onClick={runCalc}
          style={{
            padding: '0.75rem',
            background: '#333',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            marginTop: '0.5rem',
          }}
        >
          Calculate
        </button>
      </div>

      {error && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#fee', border: '1px solid #c00' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f5f5f5', border: '1px solid #ddd' }}>
          <h2 style={{ marginTop: 0 }}>Breakdown</h2>
          <p>Worked: {result.worked_hours} hrs</p>
          <p>Billed: {result.billed_hours} hrs (minimum: {result.minimum_applied})</p>

          <h3>Worked pay slices</h3>
          <ul>
            {result.worked_slices.map((slice, i) => (
              <li key={i}>
                {slice.hours} hr × ${slice.rate.toFixed(2)} × {slice.multiplier}× = $
                {(slice.hours * slice.rate * slice.multiplier).toFixed(2)}
                {' '}({slice.applied_rules.join(', ')})
              </li>
            ))}
          </ul>

          {result.padding_slice && (
            <p>
              Padding: {result.padding_slice.hours} hr × ${result.padding_slice.rate} × 1.0× = $
              {(result.padding_slice.hours * result.padding_slice.rate).toFixed(2)} (minimum_padding)
            </p>
          )}

          <p>Base pay: ${result.base_pay.toFixed(2)}</p>
          <p>Meal penalty: ${result.meal_penalty_pay.toFixed(2)}</p>
          <p>Forced call: ${result.forced_call_pay.toFixed(2)}</p>
          <p><strong>Subtotal: ${result.subtotal.toFixed(2)}</strong></p>
          <p>Fringe ({TEST_SNAPSHOT.fringe_percent}%, {result.fringe_in_check ? 'in check' : 'separate'}): ${result.fringe_amount.toFixed(2)}</p>
          <p style={{ fontSize: '1.2rem' }}>
            <strong>Total expected: ${result.total_expected.toFixed(2)}</strong>
          </p>

          {result.warnings.length > 0 && (
            <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#ffeaa7' }}>
              <strong>Warnings:</strong>
              <ul>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
