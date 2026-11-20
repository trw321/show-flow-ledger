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
  createdAt: string;
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

/** Angle between neighbours on a company's fan. */
const fanStep = (n: number) => (n <= 1 ? 0 : Math.min(0.9, (1.4 * Math.PI) / (n - 1)));
/** How far a company's people sit from it: clear of its label, and far enough apart. */
const fanRadius = (n: number) => (n <= 1 ? 110 : Math.max(110, 80 / fanStep(n)));

/**
 * Places everyone: companies on a ring around you, and each company's people
 * fanned out on the far side of it, away from you, so no one sits on a line
 * or a label.
 */
export function layoutNetwork(contacts: NetworkContact[]): NetworkLayout {
  const groups = new Map<string, NetworkContact[]>();
  for (const c of [...contacts].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = companyOf(c);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
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
