import { useEffect, useRef } from 'react';
import L from '@/lib/leafletGlobal';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { NetworkContact } from '@/lib/network';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/**
 * The real map: everyone pinned where they're based. Nearby people gather
 * into a bubble with a count, and the bubbles split apart as you zoom in,
 * from country to state to city. People in the same city fan out when
 * their bubble is tapped at full zoom. Tap a person for their card.
 */
export default function NetworkGeoMap({ contacts, onSelect }: { contacts: NetworkContact[]; onSelect: (c: NetworkContact) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const fittedFor = useRef('');

  useEffect(() => {
    if (!el.current) return;
    // Zoomed out no further than the whole world filling the box.
    const map = L.map(el.current, { worldCopyJump: true, zoomControl: true, minZoom: 2 }).setView([39.5, -98.35], 3);
    // OpenStreetMap's own tiles, darkened in CSS (.net-map-tiles) to sit in the app.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: 'net-map-tiles',
    }).addTo(map);
    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 55,
      iconCreateFunction: c => L.divIcon({ html: `<div class="net-cluster">${c.getChildCount()}</div>`, className: 'net-cluster-wrap', iconSize: [46, 46] }),
    });
    map.addLayer(cluster);
    mapRef.current = map;
    clusterRef.current = cluster;
    // The box can still be settling when the map starts (it loads in late),
    // and a map sized too early only draws part of itself: re-measure on any
    // change of size.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(el.current);
    const settle = window.setTimeout(() => map.invalidateSize(), 250);
    return () => {
      resize.disconnect();
      window.clearTimeout(settle);
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;
    cluster.clearLayers();
    const pinned = contacts.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
    for (const c of pinned) {
      const icon = L.divIcon({
        html: `<div class="net-pin">${escapeHtml(c.emoji || '🙂')}</div><div class="net-pin-name">${escapeHtml(c.name)}</div>`,
        className: 'net-pin-wrap',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
      L.marker([c.lat!, c.lng!], { icon, title: c.name, keyboard: true }).on('click', () => selectRef.current(c)).addTo(cluster);
    }
    // Frame everyone when the set of pins changes, not on every edit.
    const key = pinned.map(c => `${c.id}:${c.lat},${c.lng}`).sort().join('|');
    if (pinned.length > 0 && key !== fittedFor.current) {
      fittedFor.current = key;
      map.fitBounds(L.latLngBounds(pinned.map(c => [c.lat!, c.lng!] as [number, number])), { padding: [48, 48], maxZoom: 9 });
    }
  }, [contacts]);

  return <div ref={el} className="relative z-0 h-[60vh] w-full overflow-hidden rounded-md" data-testid="network-geo-map" />;
}
