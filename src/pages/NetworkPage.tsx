import { lazy, Suspense, useMemo, useState } from 'react';
import { usePanZoom } from '@/lib/usePanZoom';
import { toast } from 'sonner';
import { Loader2, Mail, MapPin, Pencil, Phone, Plus, Share2, Trash2 } from 'lucide-react';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { byMarket, CONTACT_EMOJIS, layoutNetwork, marketOf, NO_COMPANY, NO_MARKET, placeQuery, sameName, telHref, type NetworkContact } from '@/lib/network';
import { findPlace } from '@/lib/geocode';

// The real map is a big library, so it loads when the Network tab does.
const NetworkGeoMap = lazy(() => import('@/components/NetworkGeoMap'));
import { cn } from '@/lib/utils';

type Draft = Omit<NetworkContact, 'id' | 'createdAt'>;
const EMPTY: Draft = { name: '', emoji: '🙂', company: '', role: '', phone: '', email: '', notes: '', city: '', region: '', country: '' };

/**
 * Your network as a map: you in the middle, each company around you, and
 * its people around it. Tap someone to see how to reach them.
 */
export default function NetworkPage() {
  const { prefs, setContacts } = useUserPrefs();
  const contacts = prefs.contacts;
  const layout = useMemo(() => layoutNetwork(contacts), [contacts]);
  const [showing, setShowing] = useState<NetworkContact | null>(null);
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const [view, setView] = useState<'map' | 'network'>('map');
  const [saving, setSaving] = useState(false);
  const markets = useMemo(() => byMarket(contacts), [contacts]);
  const unpinned = contacts.filter(c => !Number.isFinite(c.lat) || !Number.isFinite(c.lng)).length;
  const companies = useMemo(() => [...new Set(contacts.map(c => c.company?.trim()).filter(Boolean) as string[])].sort(), [contacts]);

  const save = async () => {
    if (!editing) return;
    const name = editing.draft.name.trim();
    if (!name) { toast.error('Add a name'); return; }
    const clean: Draft = {
      ...editing.draft,
      name,
      company: editing.draft.company?.trim() || undefined,
      role: editing.draft.role?.trim() || undefined,
      phone: editing.draft.phone?.trim() || undefined,
      email: editing.draft.email?.trim() || undefined,
      notes: editing.draft.notes?.trim() || undefined,
      city: editing.draft.city?.trim() || undefined,
      region: editing.draft.region?.trim() || undefined,
      country: editing.draft.country?.trim() || undefined,
    };
    // Look the place up when it's new or changed; keep the pin otherwise.
    const before = editing.id ? contacts.find(c => c.id === editing.id) : undefined;
    const query = placeQuery(clean);
    if (!query) {
      clean.lat = undefined;
      clean.lng = undefined;
    } else if (!before || placeQuery(before) !== query || !Number.isFinite(before.lat)) {
      setSaving(true);
      const place = await findPlace(query);
      setSaving(false);
      clean.lat = place?.lat;
      clean.lng = place?.lng;
      if (!place) toast.error('Couldn’t find "' + query + '" on the map. Saved without a pin.');
    }
    if (editing.id) {
      const next = contacts.map(c => (c.id === editing.id ? { ...c, ...clean } : c));
      setContacts(next);
      setShowing(next.find(c => c.id === editing.id) ?? null);
    } else {
      setContacts([...contacts, { ...clean, id: crypto.randomUUID(), createdAt: new Date().toISOString() }]);
    }
    setEditing(null);
  };

  const remove = (c: NetworkContact) => {
    const before = contacts;
    setContacts(contacts.filter(x => x.id !== c.id));
    setShowing(null);
    toast(`Removed ${c.name}`, { action: { label: 'Undo', onClick: () => setContacts(before) } });
  };

  // The company map fills the screen's width, everyone in view, and moves
  // with a finger: drag to move, pinch or + and − to zoom, Fit to see all.
  const pan = usePanZoom(layout.box);
  return (
    <SpacePageWrapper
      title={
        <div className="flex items-center gap-2.5">
          <Share2 size={22} aria-hidden />
          <h1 className="text-lg font-display tracking-wide leading-none">Network</h1>
        </div>
      }
      description={`${contacts.length} ${contacts.length === 1 ? 'person' : 'people'} · ${companies.length} ${companies.length === 1 ? 'company' : 'companies'}`}
      action={<Button size="sm" onClick={() => setEditing({ draft: { ...EMPTY } })}><Plus size={14} /> Add a person</Button>}
    >
      <div className="max-w-lg mx-auto space-y-4">
        {contacts.length === 0 ? (
          <div className="pixel-panel p-4 text-center space-y-2">
            <p className="text-sm font-medium">Start your map</p>
            <p className="text-xs text-muted-foreground">Add the people you work with. Each one shows up around their company, with you in the middle. Tap anyone to call or email them.</p>
            <Button size="sm" onClick={() => setEditing({ draft: { ...EMPTY } })}><Plus size={14} /> Add a person</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2" role="tablist">
            {(['map', 'network'] as const).map(v => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={cn('pixel-button py-2 text-xs font-bold', view === v ? 'pick-on' : 'pick-off')}>
                {v === 'map' ? 'Map · by market' : 'Network · by company'}
              </button>
            ))}
          </div>
        )}

        {contacts.length > 0 && view === 'map' && (
          <div className="pixel-panel p-1 space-y-1">
            <Suspense fallback={<div className="flex h-[60vh] items-center justify-center text-xs text-muted-foreground"><Loader2 size={16} className="mr-2 animate-spin" /> Loading the map…</div>}>
              <NetworkGeoMap contacts={contacts} onSelect={setShowing} />
            </Suspense>
            {unpinned > 0 && (
              <p className="px-2 pb-1 text-[10px] text-muted-foreground">{unpinned === 1 ? '1 person isn’t' : unpinned + ' people aren’t'} on the map yet: add a city to place them.</p>
            )}
          </div>
        )}

        {contacts.length > 0 && view === 'network' && (
          <div className="pixel-panel relative overflow-hidden p-1" data-testid="network-map">
            <div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
              <button type="button" onClick={pan.zoomIn} aria-label="Zoom in" className="pixel-button pick-off h-9 w-9 text-lg font-bold leading-none">+</button>
              <button type="button" onClick={pan.zoomOut} aria-label="Zoom out" className="pixel-button pick-off h-9 w-9 text-lg font-bold leading-none">−</button>
              <button type="button" onClick={pan.fit} aria-label="Fit everyone" className="pixel-button pick-off h-9 w-9 text-[10px] font-bold">Fit</button>
            </div>
            <svg ref={pan.svgRef} viewBox={pan.viewBox} {...pan.handlers}
              className="block h-[60vh] w-full select-none" style={{ touchAction: 'none' }} role="img" aria-label="Your network map">
              {layout.companies.map(co => (
                <line key={'l-' + co.name} x1={0} y1={0} x2={co.x} y2={co.y} className="stroke-border" strokeWidth={2} />
              ))}
              {layout.people.map(p => {
                const co = layout.companies.find(c => sameName(c.name) === sameName(p.contact.company?.trim() || NO_COMPANY));
                if (!co) return null;
                return <line key={'pl-' + p.contact.id} x1={co.x} y1={co.y} x2={p.x} y2={p.y} className="stroke-border" strokeWidth={1.5} strokeDasharray="4 4" />;
              })}
              <g>
                <circle cx={0} cy={0} r={50} className="fill-primary" />
                <text x={0} y={9} textAnchor="middle" className="fill-primary-foreground" style={{ fontSize: 28, fontWeight: 800 }}>You</text>
              </g>
              {layout.companies.map(co => (
                <g key={'c-' + co.name}>
                  <rect x={co.x - 90} y={co.y - 25} width={180} height={50} rx={25} className="fill-secondary stroke-primary/60" strokeWidth={2.5} />
                  <text x={co.x} y={co.y + 8} textAnchor="middle" className="fill-foreground" style={{ fontSize: 22, fontWeight: 800 }}>
                    {co.name.length > 17 ? co.name.slice(0, 16) + '…' : co.name}
                  </text>
                </g>
              ))}
              {layout.people.map(p => (
                <g key={'p-' + p.contact.id} role="button" tabIndex={0} aria-label={p.contact.name} className="cursor-pointer"
                  onClick={() => setShowing(p.contact)} onKeyDown={e => { if (e.key === 'Enter') setShowing(p.contact); }}>
                  <circle cx={p.x} cy={p.y} r={38} className="fill-card stroke-primary" strokeWidth={3} />
                  <text x={p.x} y={p.y + 14} textAnchor="middle" style={{ fontSize: 40 }}>{p.contact.emoji || '🙂'}</text>
                  <text x={p.x} y={p.y + 64} textAnchor="middle" className="fill-foreground" style={{ fontSize: 20, fontWeight: 700 }}>
                    {p.contact.name.length > 16 ? p.contact.name.slice(0, 15) + '…' : p.contact.name}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}

        {contacts.length > 0 && (
          <div className="space-y-1">
            {markets.map(({ market, people }) => (
              <div key={market} className="space-y-1 pt-1">
                <p className="flex items-center gap-1 text-[10px] text-mono uppercase tracking-wider text-muted-foreground">
                  <MapPin size={11} aria-hidden /> {market} · {people.length}
                </p>
                {people.map(c => (
                  <button key={c.id} type="button" onClick={() => setShowing(c)} className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-secondary/40">
                    <span className="text-2xl leading-none">{c.emoji || '🙂'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{[c.role, c.company].filter(Boolean).join(' · ') || 'Independent'}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Someone's card: how to reach them. */}
      <Dialog open={!!showing} onOpenChange={open => { if (!open) setShowing(null); }}>
        {showing && (
          <DialogContent className="max-w-sm" data-testid="contact-card">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-left">
                <span className="text-4xl leading-none">{showing.emoji || '🙂'}</span>
                <span className="min-w-0">
                  <span className="block text-lg">{showing.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{[showing.role, showing.company].filter(Boolean).join(' · ') || 'Independent'}</span>
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              {showing.phone && (
                <a href={telHref(showing.phone)} className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-secondary/40">
                  <Phone size={16} className="text-primary" /> {showing.phone}
                </a>
              )}
              {showing.email && (
                <a href={`mailto:${showing.email}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5 text-sm hover:bg-secondary/40 break-all">
                  <Mail size={16} className="shrink-0 text-primary" /> {showing.email}
                </a>
              )}
              {!showing.phone && !showing.email && <p className="text-xs text-muted-foreground">No number or email yet.</p>}
              <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <MapPin size={14} aria-hidden /> {marketOf(showing) === NO_MARKET ? 'No market yet' : marketOf(showing)}
                {marketOf(showing) !== NO_MARKET && !Number.isFinite(showing.lat) && ' · not on the map'}
              </p>
              {showing.notes && <p className="whitespace-pre-wrap rounded-md bg-secondary/30 px-3 py-2 text-xs">{showing.notes}</p>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditing({ id: showing.id, draft: { ...EMPTY, ...showing } }); }}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" aria-label={`Remove ${showing.name}`} onClick={() => remove(showing)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* Adding or editing someone. */}
      <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}>
        {editing && (
          <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto" data-testid="contact-editor">
            <DialogHeader>
              <DialogTitle>{editing.id ? 'Edit' : 'Add a person'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <span className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Their emoji</span>
                <div className="grid grid-cols-8 gap-1">
                  {CONTACT_EMOJIS.map(e => (
                    <button key={e} type="button" onClick={() => setEditing({ ...editing, draft: { ...editing.draft, emoji: e } })} aria-pressed={editing.draft.emoji === e}
                      className={cn('rounded-md py-1 text-xl', editing.draft.emoji === e ? 'bg-primary/20 ring-2 ring-primary' : 'hover:bg-secondary/50')}>
                      {e}
                    </button>
                  ))}
                </div>
                <Input value={editing.draft.emoji ?? ''} maxLength={4} placeholder="Or type one" className="h-9 w-28 text-center text-lg"
                  onChange={e => setEditing({ ...editing, draft: { ...editing.draft, emoji: e.target.value } })} />
              </div>
              {([
                ['name', 'Name', 'Sam Rivera', 'text'],
                ['company', 'Company', 'Odeum', 'text'],
                ['role', 'What they do', 'Production manager', 'text'],
                ['phone', 'Phone', '(415) 555-0100', 'tel'],
                ['email', 'Email', 'sam@company.com', 'email'],
                ['city', 'City', 'San Francisco', 'text'],
                ['region', 'State or region', 'CA', 'text'],
                ['country', 'Country', 'USA', 'text'],
              ] as const).map(([key, label, placeholder, type]) => (
                <label key={key} className="block space-y-1">
                  <span className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">{label}</span>
                  <Input type={type} value={editing.draft[key] ?? ''} placeholder={placeholder} list={key === 'company' ? 'network-companies' : undefined}
                    onChange={e => setEditing({ ...editing, draft: { ...editing.draft, [key]: e.target.value } })} />
                </label>
              ))}
              <datalist id="network-companies">{companies.map(c => <option key={c} value={c} />)}</datalist>
              <label className="block space-y-1">
                <span className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Notes</span>
                <Textarea value={editing.draft.notes ?? ''} placeholder="Where you met, what they hire for" rows={3}
                  onChange={e => setEditing({ ...editing, draft: { ...editing.draft, notes: e.target.value } })} />
              </label>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setEditing(null)}>Cancel</Button>
                <Button className="flex-1" onClick={() => void save()} disabled={saving}>
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Finding it on the map…</> : 'Save'}
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </SpacePageWrapper>
  );
}
