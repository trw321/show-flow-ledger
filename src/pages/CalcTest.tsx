import { useState } from 'react';
import { calculatePayBreakdown } from '@/lib/payroll/pay-breakdown';
import type { ContractSnapshot } from '@/types/contracts';
import type {
  GigFacts,
  ConsecutiveDayContext,
  GigPayBreakdown,
  MealBreak,
} from '@/lib/payroll/types';

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

// Dark text on light backgrounds — explicit, no inheritance surprises.
const styles = {
  page: {
    maxWidth: '720px',
    margin: '2rem auto',
    padding: '1.5rem',
    fontFamily: 'system-ui, sans-serif',
    background: '#ffffff',
    color: '#1a1a1a',
    minHeight: '100vh',
  },
  heading: {
    color: '#1a1a1a',
    fontSize: '1.5rem',
    marginBottom: '0.5rem',
  },
  subheading: {
    color: '#1a1a1a',
    fontSize: '1.1rem',
    marginTop: '1rem',
    marginBottom: '0.5rem',
  },
  description: {
    color: '#555555',
    marginBottom: '1rem',
  },
  formRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.25rem',
    marginBottom: '0.75rem',
    color: '#1a1a1a',
  },
  label: {
    color: '#1a1a1a',
    fontWeight: 500,
  },
  input: {
    padding: '0.5rem',
    fontSize: '1rem',
    border: '1px solid #cccccc',
    borderRadius: '4px',
    background: '#ffffff',
    color: '#1a1a1a',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.5rem',
    color: '#1a1a1a',
  },
  button: {
    padding: '0.75rem 1.5rem',
    background: '#1a1a1a',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 500,
    marginTop: '0.5rem',
  },
  secondaryButton: {
    padding: '0.4rem 0.8rem',
    background: '#ffffff',
    color: '#1a1a1a',
    border: '1px solid #1a1a1a',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  removeButton: {
    padding: '0.25rem 0.6rem',
    background: '#ffffff',
    color: '#990000',
    border: '1px solid #990000',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
  mealRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr auto auto',
    gap: '0.5rem',
    alignItems: 'end',
    marginBottom: '0.5rem',
    padding: '0.5rem',
    background: '#f8f8f8',
    border: '1px solid #dddddd',
    borderRadius: '4px',
    color: '#1a1a1a',
  },
  errorBox: {
    marginTop: '1rem',
    padding: '1rem',
    background: '#ffe5e5',
    border: '1px solid #cc0000',
    borderRadius: '4px',
    color: '#990000',
  },
  resultBox: {
    marginTop: '1.5rem',
    padding: '1rem',
    background: '#f8f8f8',
    border: '1px solid #dddddd',
    borderRadius: '4px',
    color: '#1a1a1a',
  },
  total: {
    fontSize: '1.25rem',
    fontWeight: 600,
    color: '#1a1a1a',
    marginTop: '0.5rem',
  },
  warningBox: {
    marginTop: '1rem',
    padding: '0.75rem',
    background: '#fff4cc',
    border: '1px solid #cc9900',
    borderRadius: '4px',
    color: '#664400',
  },
  sliceList: {
    listStyle: 'none',
    padding: 0,
    margin: '0.5rem 0',
  },
  sliceItem: {
    padding: '0.25rem 0',
    color: '#1a1a1a',
  },
};

type MealInput = {
  startHHMM: string;          // "18:00"
  duration_minutes: number;
  on_clock: boolean;
};

export default function CalcTest() {
  // Shift inputs — wall-clock based
  const [startHHMM, setStartHHMM] = useState('16:00');
  const [endHHMM, setEndHHMM] = useState('02:00');         // crosses midnight
  const [rate, setRate] = useState('55.72');

  // Meals — array of structured entries
  const [meals, setMeals] = useState<MealInput[]>([]);

  // Other gig flags
  const [isHead, setIsHead] = useState(false);
  const [isSplit, setIsSplit] = useState(false);
  const [priorDaysWorked, setPriorDaysWorked] = useState('0');

  const [result, setResult] = useState<GigPayBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addMeal() {
    setMeals([...meals, { startHHMM: '21:00', duration_minutes: 60, on_clock: false }]);
  }

  function updateMeal(idx: number, patch: Partial<MealInput>) {
    setMeals(meals.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  function removeMeal(idx: number) {
    setMeals(meals.filter((_, i) => i !== idx));
  }

  function runCalc() {
    setError(null);
    setResult(null);
    try {
      const workDate = new Date();
      workDate.setHours(0, 0, 0, 0);

      const startTime = parseHHMM(workDate, startHHMM);
      let endTime = parseHHMM(workDate, endHHMM);
      // Cross-midnight: if end is at or before start, bump it to next day.
      if (endTime.getTime() <= startTime.getTime()) {
        endTime = new Date(endTime.getTime() + 24 * 60 * 60 * 1000);
      }

      const meal_breaks: MealBreak[] = meals.map((m) => {
        let mealStart = parseHHMM(workDate, m.startHHMM);
        // If meal time is before shift start in clock terms, assume it's
        // the next day (post-midnight meal during an overnight shift).
        if (mealStart.getTime() < startTime.getTime()) {
          mealStart = new Date(mealStart.getTime() + 24 * 60 * 60 * 1000);
        }
        return {
          start_time: mealStart,
          duration_minutes: m.duration_minutes,
          on_clock: m.on_clock,
        };
      });

      const facts: GigFacts = {
        work_date: workDate,
        start_time: startTime,
        end_time: endTime,
        meal_breaks,
        is_head: isHead,
        is_split: isSplit,
        minimum_hours_override: null,
        forced_call: false,
        offered_hourly_rate: parseFloat(rate),
        offered_day_rate: null,
        offered_flat_amount: null,
      };

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
    <main style={styles.page}>
      <h1 style={styles.heading}>Calc Engine Test</h1>
      <p style={styles.description}>
        Hardcoded Local 16 contract. Worked hours and meal penalty are derived
        from shift times + meal break entries.
      </p>

      <div style={styles.formRow}>
        <label style={styles.label}>Shift start (HH:MM, 24hr):</label>
        <input
          type="text"
          value={startHHMM}
          onChange={(e) => setStartHHMM(e.target.value)}
          style={styles.input}
          placeholder="16:00"
        />
      </div>

      <div style={styles.formRow}>
        <label style={styles.label}>Shift end (HH:MM, 24hr — crosses midnight if before start):</label>
        <input
          type="text"
          value={endHHMM}
          onChange={(e) => setEndHHMM(e.target.value)}
          style={styles.input}
          placeholder="02:00"
        />
      </div>

      <div style={styles.formRow}>
        <label style={styles.label}>Offered hourly rate:</label>
        <input
          type="number"
          step="0.01"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          style={styles.input}
        />
      </div>

      <h2 style={styles.subheading}>Meal breaks</h2>
      <p style={styles.description}>
        Add each meal taken. Empty list on a 5+ hour shift will trigger meal
        penalty automatically.
      </p>

      {meals.map((meal, idx) => (
        <div key={idx} style={styles.mealRow}>
          <div>
            <label style={styles.label}>Start (HH:MM)</label>
            <input
              type="text"
              value={meal.startHHMM}
              onChange={(e) => updateMeal(idx, { startHHMM: e.target.value })}
              style={styles.input}
            />
          </div>
          <div>
            <label style={styles.label}>Duration (min)</label>
            <input
              type="number"
              min="1"
              value={meal.duration_minutes}
              onChange={(e) =>
                updateMeal(idx, { duration_minutes: parseInt(e.target.value) || 0 })
              }
              style={styles.input}
            />
          </div>
          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={meal.on_clock}
              onChange={(e) => updateMeal(idx, { on_clock: e.target.checked })}
            />
            on-clock
          </label>
          <button
            type="button"
            onClick={() => removeMeal(idx)}
            style={styles.removeButton}
          >
            Remove
          </button>
        </div>
      ))}

      <button type="button" onClick={addMeal} style={styles.secondaryButton}>
        + Add meal break
      </button>

      <h2 style={styles.subheading}>Other</h2>

      <div style={styles.formRow}>
        <label style={styles.label}>Prior consecutive days worked (in last 6 days):</label>
        <input
          type="number"
          min="0"
          max="6"
          value={priorDaysWorked}
          onChange={(e) => setPriorDaysWorked(e.target.value)}
          style={styles.input}
        />
      </div>

      <div style={styles.checkboxRow}>
        <input
          type="checkbox"
          id="is-head"
          checked={isHead}
          onChange={(e) => setIsHead(e.target.checked)}
        />
        <label htmlFor="is-head" style={styles.label}>
          Is head/lead (8hr minimum)
        </label>
      </div>

      <div style={styles.checkboxRow}>
        <input
          type="checkbox"
          id="is-split"
          checked={isSplit}
          onChange={(e) => setIsSplit(e.target.checked)}
        />
        <label htmlFor="is-split" style={styles.label}>
          Is split shift (4hr minimum)
        </label>
      </div>

      <button onClick={runCalc} style={styles.button}>
        Calculate
      </button>

      {error && (
        <div style={styles.errorBox}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={styles.resultBox}>
          <h2 style={styles.subheading}>Breakdown</h2>
          <p>Worked hours (derived): {result.worked_hours.toFixed(4)}</p>
          <p>
            Billed hours: {result.billed_hours.toFixed(2)} (minimum applied:{' '}
            {result.minimum_applied})
          </p>

          <h3 style={styles.subheading}>Worked pay slices</h3>
          <ul style={styles.sliceList}>
            {result.worked_slices.map((slice, i) => (
              <li key={i} style={styles.sliceItem}>
                {slice.hours.toFixed(4)} hr × ${slice.rate.toFixed(2)} ×{' '}
                {slice.multiplier} = ${(slice.hours * slice.rate * slice.multiplier).toFixed(2)}
                {' — '}
                {slice.applied_rules.join(', ')}
              </li>
            ))}
          </ul>

          {result.padding_slice && (
            <>
              <h3 style={styles.subheading}>Padding slice (minimum)</h3>
              <p>
                {result.padding_slice.hours.toFixed(2)} hr × $
                {result.padding_slice.rate.toFixed(2)} × {result.padding_slice.multiplier} = $
                {(
                  result.padding_slice.hours *
                  result.padding_slice.rate *
                  result.padding_slice.multiplier
                ).toFixed(2)}
              </p>
            </>
          )}

          <h3 style={styles.subheading}>Totals</h3>
          <p>Base pay: ${result.base_pay.toFixed(2)}</p>
          <p>Meal penalty: ${result.meal_penalty_pay.toFixed(2)}</p>
          {result.forced_call_pay > 0 && (
            <p>Forced call: ${result.forced_call_pay.toFixed(2)}</p>
          )}
          <p>Subtotal: ${result.subtotal.toFixed(2)}</p>
          <p>
            Fringe ({result.fringe_in_check ? 'in check' : 'separate'}): $
            {result.fringe_amount.toFixed(2)}
          </p>
          <p style={styles.total}>
            Total expected on check: ${result.total_expected.toFixed(2)}
          </p>

          {result.warnings.length > 0 && (
            <div style={styles.warningBox}>
              <strong>Warnings:</strong>
              <ul>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function parseHHMM(baseDate: Date, hhmm: string): Date {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr || '0', 10);
  const m = parseInt(mStr || '0', 10);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}
