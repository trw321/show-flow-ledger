/**
 * Your network: the people you know in the business, drawn as a map. You in
 * the middle, each company around you, and its people around it, so who
 * works where reads at a glance. Kept with your synced settings.
 */

export interface NetworkContact {
  id: string;
  name: string;
  /** What stands for them on the map: an emoji or a short symbol. */
  emoji?: string;
  company?: string;
  role?: string;
  phone?: string;
  email?: string;
  notes?: string;
  /** Their market: where they're based. */
  city?: string;
  region?: string;
  country?: string;
  /** Where that place is on the map, looked up once from city, region and country. */
  lat?: number;
  lng?: number;
  createdAt: string;
}

/** What a place is looked up by. */
export const placeQuery = (c: Pick<NetworkContact, 'city' | 'region' | 'country'>) =>
  [c.city, c.region, c.country].map(v => v?.trim()).filter(Boolean).join(', ');

export const NO_MARKET = 'No market yet';

/** Their market as a label: "San Francisco, CA", or the state or country alone. */
export function marketOf(c: Pick<NetworkContact, 'city' | 'region' | 'country'>): string {
  const city = c.city?.trim();
  const region = c.region?.trim();
  const country = c.country?.trim();
  if (city) return region ? `${city}, ${region}` : country ? `${city}, ${country}` : city;
  return region || country || NO_MARKET;
}

/** Everyone by market, the biggest markets first, and "No market yet" last. */
export function byMarket(contacts: NetworkContact[]): { market: string; people: NetworkContact[] }[] {
  const groups = groupBy(contacts, marketOf);
  return [...groups.entries()]
    .map(([market, people]) => ({ market, people: people.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.market === NO_MARKET ? 1 : b.market === NO_MARKET ? -1 : b.people.length - a.people.length || a.market.localeCompare(b.market)));
}

/** Emojis to pick from for a person. */
export const CONTACT_EMOJIS = ['🙂', '😎', '🤠', '🧢', '👷', '🎧', '🎤', '🎛️', '💡', '🔌', '🎥', '📹', '🎬', '🔧', '🪜', '🧰', '📋', '💼', '⭐', '🔥', '🦄', '🐻', '🌵', '🎸'];

export const NO_COMPANY = 'Independent';

export interface PlacedPerson { contact: NetworkContact; x: number; y: number }
export interface PlacedCompany { name: string; x: number; y: number; people: number }
export interface NetworkLayout {
  you: { x: number; y: number };
  companies: PlacedCompany[];
  people: PlacedPerson[];
  /** The box everything fits in, for an SVG viewBox. */
  box: { x: number; y: number; width: number; height: number };
}

const companyOf = (c: NetworkContact) => c.company?.trim() || NO_COMPANY;

/** What two spellings of one name share: "seattle" and "Seattle " are one market. */
export const sameName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The spelling to show for a group: one with capitals if anyone typed it so, else each word capitalised. */
function bestSpelling(spellings: string[]): string {
  const typed = spellings.map(x => x.replace(/\s+/g, ' ').trim());
  return typed.find(x => x !== x.toLowerCase()) ?? typed[0].replace(/\b\w/g, ch => ch.toUpperCase());
}

/** Contacts grouped by a name, ignoring capitals and spacing, each group shown by its best spelling. */
function groupBy(contacts: NetworkContact[], nameOf: (c: NetworkContact) => string): Map<string, NetworkContact[]> {
  const byKey = new Map<string, { spellings: string[]; people: NetworkContact[] }>();
  for (const c of contacts) {
    const name = nameOf(c);
    const key = sameName(name);
    const g = byKey.get(key) ?? { spellings: [], people: [] };
    g.spellings.push(name);
    g.people.push(c);
    byKey.set(key, g);
  }
  return new Map([...byKey.values()].map(g => [bestSpelling(g.spellings), g.people]));
}

/** Angle between neighbours on a company's fan. */
const fanStep = (n: number) => (n <= 1 ? 0 : Math.min(0.9, (1.4 * Math.PI) / (n - 1)));
/** How far a company's people sit from it: clear of its label, and far enough apart. */
const fanRadius = (n: number) => (n <= 1 ? 120 : Math.max(120, 95 / fanStep(n)));

/**
 * Places everyone: companies on a ring around you, and each company's people
 * fanned out on the far side of it, away from you, so no one sits on a line
 * or a label.
 */
export function layoutNetwork(contacts: NetworkContact[]): NetworkLayout {
  const groups = groupBy([...contacts].sort((a, b) => a.name.localeCompare(b.name)), companyOf);
  const names = [...groups.keys()].sort((a, b) => (a === NO_COMPANY ? 1 : b === NO_COMPANY ? -1 : a.localeCompare(b)));
  // Each company needs room for its fan; the ring is as big as they all need.
  const room = names.map(n => 2 * (fanRadius(groups.get(n)!.length) + 70));
  const companyRing = Math.max(230, room.reduce((sum, r) => sum + r, 0) / (2 * Math.PI));

  const companies: PlacedCompany[] = [];
  const people: PlacedPerson[] = [];
  names.forEach((name, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, names.length);
    const x = Math.cos(angle) * companyRing;
    const y = Math.sin(angle) * companyRing;
    const members = groups.get(name)!;
    companies.push({ name, x, y, people: members.length });
    const r = fanRadius(members.length);
    const step = fanStep(members.length);
    members.forEach((contact, j) => {
      const a = angle + (j - (members.length - 1) / 2) * step;
      people.push({ contact, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    });
  });

  const xs = [0, ...companies.map(c => c.x), ...people.map(p => p.x)];
  const ys = [0, ...companies.map(c => c.y), ...people.map(p => p.y)];
  const padX = 110;
  const padY = 80;
  const minX = Math.min(...xs) - padX;
  const minY = Math.min(...ys) - padY;
  return {
    you: { x: 0, y: 0 },
    companies,
    people,
    box: { x: minX, y: minY, width: Math.max(...xs) + padX - minX, height: Math.max(...ys) + padY - minY },
  };
}

/** A phone number as something to dial. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
