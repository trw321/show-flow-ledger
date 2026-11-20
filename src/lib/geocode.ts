/**
 * Turning "San Francisco, CA, USA" into a spot on the map, with
 * OpenStreetMap's place search (Nominatim). Only the place is sent, never a
 * name, and each contact is looked up once, when its place is saved, and kept.
 */

export interface Place {
  lat: number;
  lng: number;
}

const SEARCH = 'https://nominatim.openstreetmap.org/search';

export async function findPlace(query: string): Promise<Place | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await fetch(`${SEARCH}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { 'Accept-Language': 'en' },
    });
    if (!res.ok) return null;
    const hits = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = hits[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}
