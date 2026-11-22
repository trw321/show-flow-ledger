/**
 * A call time, short: "8:00 AM" is "8a", "7:30 PM" is "7:30p". What a calendar
 * day shows before it has pay to show. Anything else is left out.
 */
export function shortCall(time: string | undefined): string {
  const t = time?.trim() ?? '';
  const twelve = t.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i);
  if (twelve) {
    const h = Number(twelve[1]);
    if (h < 1 || h > 12) return '';
    return `${h}${twelve[2] && twelve[2] !== '00' ? `:${twelve[2]}` : ''}${twelve[3].toLowerCase()}`;
  }
  const day = t.match(/^(\d{1,2}):(\d{2})$/);
  if (day) {
    const h = Number(day[1]);
    if (h > 23) return '';
    return `${h % 12 || 12}${day[2] !== '00' ? `:${day[2]}` : ''}${h < 12 ? 'a' : 'p'}`;
  }
  return '';
}
