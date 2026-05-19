import { useState } from 'react';
import { calculatePayBreakdown } from '@/lib/payroll/pay-breakdown';
import type { ContractSnapshot } from '@/types/contracts';
import type { GigFacts, ConsecutiveDayContext, GigPayBreakdown } from '@/lib/payroll/types';

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

// Explicit colors — dark text on light backgrounds for readable contrast
const styles = {
  page: {
    maxWidth: '600px',
    margin: '2rem auto',
    padding: '1.5rem',
    fontFamily: 'system-ui, sans-serif',
    background: 'lime',
    color: 'black',
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
    color: 'black',
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
};

export default function CalcTest() {
  const [workedHours, setWorkedHours] = useState('10');
  const [startHour, setStartHour] = useState('16');
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
        Hardcoded Local 16 contract. Enter values, see the math.
      </p>

      <div>
        <div style={styles.formRow}>
          <label style={styles.label}>Worked hours:</label>
          <input
            type="number"
            step="0.25"
            value={workedHours}
            onChange={(e) => setWorkedHours(e.target.value)}
            style={styles.input}
          />
        </div>

        <div style={styles.formRow}>
          <label style={styles.label}>Start hour (0-23, e.g. 16 for 4pm):</label>
          <input
            type="number"
            min="0"
            max="23"
            value={startHour}
            onChange={(e) => setStartHour(e.target.value)}
            style={styles.input}
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

        <div style={styles.formRow}>
          <label style={styles.label}>Meal penalty hours:</label>
          <input
            type="number"
            step="0.25"
            value={mealPenaltyHours}
            onChange={(e) => setMealPenaltyHours(e.target.value)}
            style={styles.input}
          />
        </div>

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
          <label htmlFor="is-head" style={styles.label}>Is head/lead (8hr minimum)</label>
        </div>

        <div style={styles.checkboxRow}>
          <input
            type="checkbox"
            id="is-split"
            checked={isSplit}
            onChange={(e) => setIsSplit(e.target.checked)}
          />
          <label htmlFor="is-split" style={styles.label}>Is split shift (4hr minimum)</label>
        </div>

        <button onClick={runCalc} style={styles.button}>
          Calculate
        </button>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div style={styles.resultBox}>
          <h2 style={styles.subheading}>Breakdown</h2>
          <p>Worked: {result.worked_hours} hrs</p>
          <p>Billed: {result.billed_hours} hrs (minimum: {result.minimum_applied})</p>

          <h3 style={styles.subheading}>Worked pay slices</h3>
          <ul>
            {result.worked_slices.map((slice, i) => (
              <li key={i}>
                {slice.hours} hr × ${slice.rate.toFixed(2)} × {slice.multiplie}
              </li>
  )
</ul>
</div>
                                      )}
