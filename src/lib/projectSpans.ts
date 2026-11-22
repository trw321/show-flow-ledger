/**
 * The employer's name over a project's days on the month grid: one label
 * across each run of days in a week row, not one a day. Two projects on the
 * same days stack, the earlier-starting one on top.
 */

export interface DayProject {
  /** The project (see projectKeysFor). */
  key: string;
  /** What to call it: the employer's name. */
  name: string;
}

export interface ProjectSpan {
  key: string;
  name: string;
  /** First and last column of the run, 0 (Sunday) to 6. */
  from: number;
  to: number;
  /** It carries on from the week before, or into the next: that end is left open. */
  openLeft: boolean;
  openRight: boolean;
  /** Which label row it sits in, 0 at the top. */
  level: number;
}

/**
 * The spans in one week row. `days` is nine days: the one before the week,
 * the week's seven, and the one after, each with the projects on it. The
 * outer two only say whether a run carries on.
 */
export function weekSpans(days: DayProject[][]): { spans: ProjectSpan[]; levels: number } {
  if (days.length !== 9) throw new Error('weekSpans needs the day before, the week, and the day after');
  const week = days.slice(1, 8).map(d => new Map(d.map(p => [p.key, p])));
  const has = (day: DayProject[], key: string) => day.some(p => p.key === key);
  const spans: ProjectSpan[] = [];
  const keys = new Set(week.flatMap(d => [...d.keys()]));
  for (const key of keys) {
    for (let i = 0; i < 7; i++) {
      if (!week[i].has(key) || (i > 0 && week[i - 1].has(key))) continue;
      let to = i;
      while (to < 6 && week[to + 1].has(key)) to++;
      spans.push({
        key,
        name: week[i].get(key)!.name,
        from: i,
        to,
        openLeft: i === 0 && has(days[0], key),
        openRight: to === 6 && has(days[8], key),
        level: 0,
      });
    }
  }
  // Earliest first, the longer of two starting together first; each takes the
  // highest row free across its days.
  spans.sort((a, b) => a.from - b.from || b.to - a.to || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  spans.forEach((span, n) => {
    const taken = new Set(spans.slice(0, n).filter(o => o.from <= span.to && span.from <= o.to).map(o => o.level));
    let level = 0;
    while (taken.has(level)) level++;
    span.level = level;
  });
  return { spans, levels: spans.length ? Math.max(...spans.map(s => s.level)) + 1 : 0 };
}
