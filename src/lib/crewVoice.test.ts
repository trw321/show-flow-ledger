import { describe, it, expect } from 'vitest';
import { parseCrewSpeech, parsePayoutSpeech, planCrewSpeech } from './crewVoice';
import type { CrewMember, CrewShift } from './store';

const member = (id: string, name: string, payRate?: number): CrewMember => ({ id, name, payRate, createdAt: 'x' });
const jamie = member('j', 'Jamie Torres', 40);
const samLee = member('sl', 'Sam Lee', 30);
const samOrtiz = member('so', 'Sam Ortiz', 30);
const dana = member('d', 'Dana Brook', 50);
const crew = [jamie, samLee, samOrtiz, dana];

// A Wednesday.
const today = '2026-11-04';
const hear = (text: string) => parseCrewSpeech(text, crew, today);
const shift = (over: Partial<CrewShift>): CrewShift => ({ id: 's1', crewId: 'j', date: today, createdAt: 'x', ...over });
const plan = (text: string, shifts: CrewShift[] = [], now = '2:30 PM') => planCrewSpeech(hear(text), shifts, today, now);

describe('booking', () => {
  it('reads who, when, the hours and the place', () => {
    expect(hear('book Jamie Friday 8 to 6 at the Fillmore')).toMatchObject({
      action: 'book', people: [jamie], days: ['2026-11-06'], start: '8:00 AM', end: '6:00 PM', place: 'Fillmore',
    });
  });

  it('takes spoken numbers and a run of days', () => {
    expect(hear('schedule Sam Lee and Dana Monday through Wednesday nine to five')).toMatchObject({
      action: 'book', people: [samLee, dana], days: ['2026-11-09', '2026-11-10', '2026-11-11'], start: '9:00 AM', end: '5:00 PM',
    });
  });

  it('takes half past as a time', () => {
    expect(hear('book dana friday eight thirty to five')).toMatchObject({ start: '8:30 AM', end: '5:00 PM' });
  });

  it('works out the half of the day', () => {
    expect(hear('book dana friday 9 pm to 2')).toMatchObject({ start: '9:00 PM', end: '2:00 AM' });
    expect(hear('book dana friday 6 to 11 pm')).toMatchObject({ start: '6:00 PM', end: '11:00 PM' });
    expect(hear('book dana friday 8 to 6 pm')).toMatchObject({ start: '8:00 AM', end: '6:00 PM' });
    expect(hear('book dana friday noon to 8')).toMatchObject({ start: '12:00 PM', end: '8:00 PM' });
    expect(hear('book dana friday 1 to 9')).toMatchObject({ start: '1:00 PM', end: '9:00 PM' });
  });

  it('adds hours to a call', () => {
    expect(hear('book dana friday at 8 for 10 hours')).toMatchObject({ start: '8:00 AM', end: '6:00 PM', hours: 10 });
  });

  it('reads dates, ahead of today', () => {
    expect(hear('book jamie 11/20 7am to 3pm')).toMatchObject({ days: ['2026-11-20'], start: '7:00 AM', end: '3:00 PM' });
    expect(hear('book jamie december 3rd').days).toEqual(['2026-12-03']);
    expect(hear('book jamie the 20th').days).toEqual(['2026-11-20']);
    expect(hear('book jamie the 2nd').days).toEqual(['2026-12-02']);
    expect(hear('book jamie march 3').days).toEqual(['2027-03-03']);
  });

  it('knows next friday from this friday', () => {
    expect(hear('book dana friday').days).toEqual(['2026-11-06']);
    expect(hear('book dana next friday').days).toEqual(['2026-11-13']);
    expect(hear('book dana next monday').days).toEqual(['2026-11-09']);
    expect(hear('book dana tomorrow').days).toEqual(['2026-11-05']);
    expect(hear('book dana this weekend').days).toEqual(['2026-11-07', '2026-11-08']);
  });

  it('plans a shift per person per day', () => {
    const p = plan('book jamie and dana friday and saturday 8 to 6');
    expect(p.book).toHaveLength(4);
    expect(p.lines[0]).toBe('Book Jamie Torres · Fri Nov 6 · 8:00 AM–6:00 PM');
  });

  it('asks for a day rather than guessing one', () => {
    const p = plan('book jamie 8 to 6');
    expect(p.book).toEqual([]);
    expect(p.notes[0]).toMatch(/Which day/);
  });

  it('fills in a booking that has no times yet', () => {
    const p = plan('book jamie friday 8 to 6', [shift({ date: '2026-11-06' })]);
    expect(p.book).toEqual([]);
    expect(p.update[0]).toMatchObject({ id: 's1', updates: { startTime: '8:00 AM', endTime: '6:00 PM' } });
  });

  it('will not book the same call twice, but will book a second call', () => {
    const booked = [shift({ date: '2026-11-06', startTime: '8:00 AM', endTime: '12:00 PM' })];
    expect(plan('book jamie friday 8 to 12', booked).notes[0]).toMatch(/already on Fri Nov 6/);
    expect(plan('book jamie friday 2 to 6', booked).book).toHaveLength(1);
  });
});

describe('time keeping', () => {
  it('reads hours and a day already gone', () => {
    expect(hear('Jamie worked 9 hours yesterday')).toMatchObject({ action: 'worked', people: [jamie], hours: 9, days: ['2026-11-03'] });
    expect(hear('Dana worked eight and a half hours on Monday')).toMatchObject({ hours: 8.5, days: ['2026-11-02'] });
    expect(hear('Dana worked 7 and a half hours')).toMatchObject({ hours: 7.5, days: [] });
  });

  it('takes a bare number as hours', () => {
    expect(hear('Jamie worked 9 yesterday')).toMatchObject({ hours: 9, days: ['2026-11-03'] });
  });

  it('looks back for a weekday when the work is done', () => {
    expect(hear('jamie worked 10 to 6:30 tuesday')).toMatchObject({ start: '10:00 AM', end: '6:30 PM', days: ['2026-11-03'] });
    expect(hear('jamie worked friday').days).toEqual(['2026-10-30']);
    expect(hear('jamie worked last friday').days).toEqual(['2026-10-30']);
    expect(hear('jamie worked monday through friday').days).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(hear('jamie worked monday through wednesday').days).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
  });

  it('puts the hours on the shift that was booked', () => {
    const p = plan('jamie worked 9 hours yesterday', [shift({ date: '2026-11-03', startTime: '8:00 AM' })]);
    expect(p.update).toEqual([{ id: 's1', updates: { hoursWorked: 9 } }]);
    expect(p.book).toEqual([]);
  });

  it('makes the shift when none was booked', () => {
    const p = plan('jamie worked 9 hours yesterday');
    expect(p.book[0]).toMatchObject({ crewId: 'j', date: '2026-11-03', hoursWorked: 9 });
  });

  it('takes the booked times as worked when nothing else is said', () => {
    const p = plan('jamie worked yesterday', [shift({ date: '2026-11-03', startTime: '8:00 AM', endTime: '4:00 PM' })]);
    expect(p.update[0].updates.hoursWorked).toBe(8);
  });

  it('asks when it has nothing to go on', () => {
    expect(plan('jamie worked yesterday').notes[0]).toMatch(/How many hours/);
  });

  it('leaves a paid shift alone', () => {
    const p = plan('jamie worked 9 hours yesterday', [shift({ date: '2026-11-03', payoutId: 'p' })]);
    expect(p.update).toEqual([]);
    expect(p.notes[0]).toMatch(/already paid/);
  });

  it('counts everyone', () => {
    expect(hear('everyone worked 8 hours today').people).toHaveLength(4);
  });
});

describe('clocking in and out', () => {
  it('reads both ways of saying it', () => {
    expect(hear('Sam Lee clocked in').action).toBe('clock-in');
    expect(hear('clock in Dana').action).toBe('clock-in');
    expect(hear('clock Dana out at 6:30').action).toBe('clock-out');
    expect(hear('Dana punched out').action).toBe('clock-out');
  });

  it('clocks in now, on today\'s booking', () => {
    const p = plan('jamie clocked in', [shift({})], '8:03 AM');
    expect(p.update[0]).toMatchObject({ id: 's1', updates: { startTime: '8:03 AM' } });
    expect(p.lines[0]).toBe('Jamie Torres in at 8:03 AM');
  });

  it('makes a shift when nobody booked one', () => {
    expect(plan('dana clocked in', [], '8:03 AM').book[0]).toMatchObject({ crewId: 'd', date: today, startTime: '8:03 AM' });
  });

  it('takes a said time as the nearest one to now', () => {
    expect(plan('dana clocked in at 8', [], '8:30 AM').lines[0]).toBe('Dana Brook in at 8:00 AM');
    expect(plan('dana clocked in at 8', [], '7:45 PM').lines[0]).toBe('Dana Brook in at 8:00 PM');
  });

  it('clocks out and works out the hours', () => {
    const p = plan('jamie clocked out', [shift({ startTime: '8:00 AM' })], '6:30 PM');
    expect(p.update[0]).toMatchObject({ id: 's1', updates: { endTime: '6:30 PM', hoursWorked: 10.5 } });
  });

  it('takes a said time as after the call', () => {
    const p = plan('jamie clocked out at 6', [shift({ startTime: '8:00 AM' })], '6:30 PM');
    expect(p.update[0].updates).toMatchObject({ endTime: '6:00 PM', hoursWorked: 10 });
  });

  it('finishes last night\'s call after midnight', () => {
    const p = plan('jamie clocked out', [shift({ date: '2026-11-03', startTime: '9:00 PM' })], '1:30 AM');
    expect(p.update[0]).toMatchObject({ id: 's1', updates: { endTime: '1:30 AM', hoursWorked: 4.5 } });
  });

  it('says so when there is nothing to clock out of', () => {
    expect(plan('jamie clocked out').notes[0]).toMatch(/no clock-in/);
  });
});

describe('paying', () => {
  const owed = [
    shift({ id: 'a', date: '2026-10-30', hoursWorked: 10 }),
    shift({ id: 'b', date: '2026-11-02', hoursWorked: 5 }),
  ];

  it('reads the money and how it went', () => {
    expect(hear('pay jamie four hundred cash')).toMatchObject({ action: 'pay', people: [jamie], amount: 400, method: 'cash' });
    expect(hear('paid Dana $1,250.50 by venmo yesterday')).toMatchObject({ amount: 1250.5, method: 'venmo', days: ['2026-11-03'], paysForDays: false });
    expect(hear('pay jamie 300 dollars by check')).toMatchObject({ amount: 300, method: 'check' });
    expect(hear('pay jamie four fifty')).toMatchObject({ amount: 450 });
    expect(hear('pay jamie two hundred and fifty')).toMatchObject({ amount: 250 });
  });

  it('pays what is owed when no amount is said', () => {
    const p = plan('pay jamie', owed);
    expect(p.pay[0]).toMatchObject({ amount: 600, date: today });
    expect(p.pay[0].shifts.map(s => s.id)).toEqual(['a', 'b']);
    expect(p.lines[0]).toBe('Pay Jamie Torres $600.00 for 2 shifts');
  });

  it('pays only the day it was told to', () => {
    const p = plan('pay jamie for friday', owed);
    expect(p.pay[0].shifts.map(s => s.id)).toEqual(['a']);
    expect(p.pay[0].amount).toBe(400);
  });

  it('settles shifts oldest first when the money lands on them', () => {
    const p = plan('pay jamie 400', owed);
    expect(p.pay[0].shifts.map(s => s.id)).toEqual(['a']);
    expect(p.notes).toEqual([]);
  });

  it('records odd money without calling any shift paid', () => {
    const p = plan('pay jamie 350', owed);
    expect(p.pay[0]).toMatchObject({ amount: 350, shifts: [] });
    expect(p.notes[0]).toMatch(/doesn't match/);
  });

  it('dates the payment by the day said', () => {
    expect(plan('paid jamie 400 yesterday', owed).pay[0].date).toBe('2026-11-03');
  });

  it('says when nothing is owed', () => {
    expect(plan('pay jamie').notes[0]).toMatch(/Nothing owed/);
  });

  it('works out hours at their rate', () => {
    expect(plan('pay jamie for 5 hours').pay[0]).toMatchObject({ amount: 200, shifts: [] });
  });
});

describe('names', () => {
  it('asks which one when two people share a name', () => {
    const p = plan('book sam friday');
    expect(p.notes[0]).toMatch(/more than one Sam/);
    expect(p.book).toEqual([]);
  });

  it('knows a whole name from a shared one', () => {
    expect(hear('book sam ortiz friday').people).toEqual([samOrtiz]);
  });

  it('forgives what speech does to a name', () => {
    expect(hear('book Jaime friday').people).toEqual([jamie]);
  });

  it('never takes a command word for a name', () => {
    expect(hear('book jamie friday').people).toEqual([jamie]);
    expect(plan('book friday 8 to 6').notes[0]).toMatch(/name/);
  });

  it('reads a last name, and a possessive', () => {
    expect(hear('book Brook friday').people).toEqual([dana]);
    expect(hear("put Dana's name on friday").people).toEqual([dana]);
  });
});

describe('with no verb', () => {
  it('takes a day ahead as a booking and a day gone as work', () => {
    expect(hear('jamie friday 8 to 6').action).toBe('book');
    expect(hear('jamie yesterday 9 hours').action).toBe('worked');
  });

  it('says so when it can not tell', () => {
    expect(plan('jamie').notes[0]).toMatch(/what to do/);
  });
});

describe('a pay out, said', () => {
  const known = ['Jamie Torres', 'Dana Brook'];
  const say = (text: string) => parsePayoutSpeech(text, known, today);

  it('fills in the form', () => {
    expect(say('paid Jamie 300 cash for load in yesterday')).toEqual({
      worker: 'Jamie Torres', amount: 300, date: '2026-11-03', method: 'cash', jobRef: 'Load In',
    });
  });

  it('takes someone new', () => {
    expect(say('paid mike davis $150 by zelle')).toMatchObject({ worker: 'Mike Davis', amount: 150, method: 'zelle' });
    expect(say('gave chris 80 bucks')).toMatchObject({ worker: 'Chris', amount: 80 });
  });

  it('leaves out what was not said', () => {
    expect(say('jamie 200')).toEqual({ worker: 'Jamie Torres', amount: 200, date: undefined, method: undefined, jobRef: undefined });
  });
});
