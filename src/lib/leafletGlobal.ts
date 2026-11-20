import L from 'leaflet';

/**
 * Leaflet as the global `L`, set before leaflet.markercluster loads: the
 * cluster plugin extends the global rather than importing Leaflet itself.
 * Import this first, then 'leaflet.markercluster'.
 */
(window as unknown as { L: typeof L }).L = L;

export default L;
