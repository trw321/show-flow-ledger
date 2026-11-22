/**
 * Each employer's colour on the month grid, as an HSL triplet. Clear of the
 * money's four status colours (amber 40, sky 205, lilac 272, green 152), the
 * conference gold (46) and red, so an employer's name never reads as paid,
 * late or waiting.
 */
export const EMPLOYER_COLOURS = [
  '178 80% 52%', // teal
  '312 85% 68%', // pink
  '84 80% 55%', // lime
  '0 0% 92%', // white
  '22 95% 62%', // orange
  '236 90% 75%', // periwinkle
] as const;

/** How an employer is told apart: its name, ignoring case and spacing. */
export const employerId = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The colour of each employer shown. Colours go out in the order you first
 * worked for each one, so the employers you've had longest keep theirs from
 * month to month. Two shown together never share one while a colour is free:
 * the later of the two moves to the next free colour.
 *
 * `order`: every employer, first worked for first. `shown`: the ones on screen.
 */
export function employerColours(order: string[], shown: Iterable<string>): Map<string, string> {
  const rank = new Map<string, number>();
  for (const name of order) {
    const id = employerId(name);
    if (!rank.has(id)) rank.set(id, rank.size);
  }
  const ids = [...new Set([...shown].map(employerId))]
    .sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b));
  const n = EMPLOYER_COLOURS.length;
  const taken = new Set<number>();
  const colours = new Map<string, string>();
  ids.forEach((id, unranked) => {
    let i = (rank.get(id) ?? rank.size + unranked) % n;
    for (let step = 0; step < n && taken.has(i); step++) i = (i + 1) % n;
    taken.add(i);
    colours.set(id, EMPLOYER_COLOURS[i]);
  });
  return colours;
}
