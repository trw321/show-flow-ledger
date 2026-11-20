import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Mail, Pencil, Phone, Plus, Share2, Trash2 } from 'lucide-react';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { CONTACT_EMOJIS, layoutNetwork, NO_COMPANY, telHref, type NetworkContact } from '@/lib/network';
import { cn } from '@/lib/utils';

type Draft = Omit<NetworkContact, 'id' | 'createdAt'>;
const EMPTY: Draft = { name: '', emoji: '🙂', company: '', role: '', phone: '', email: '', notes: '' };

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
  const companies = useMemo(() => [...new Set(contacts.map(c => c.company?.trim()).filter(Boolean) as string[])].sort(), [contacts]);

  const save = () => {
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
    };
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

  const { box } = layout;
  // Drawn big enough to read on a phone and scrolled around, starting on you.
  const SCALE = 0.72;
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    el.scrollLeft = (-box.x) * SCALE - el.clientWidth / 2;
    el.scrollTop = (-box.y) * SCALE - el.clientHeight / 2;
  }, [box.x, box.y]);
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
          <div ref={mapRef} className="pixel-panel overflow-auto p-1" style={{ maxHeight: '62vh' }} data-testid="network-map">
            <svg viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} width={box.width * SCALE} height={box.height * SCALE} className="block mx-auto max-w-none" role="img" aria-label="Your network map">
              {layout.companies.map(co => (
                <line key={'l-' + co.name} x1={0} y1={0} x2={co.x} y2={co.y} className="stroke-border" strokeWidth={2} />
              ))}
              {layout.people.map(p => {
                const co = layout.companies.find(c => c.name === (p.contact.company?.trim() || NO_COMPANY))!;
                return <line key={'pl-' + p.contact.id} x1={co.x} y1={co.y} x2={p.x} y2={p.y} className="stroke-border" strokeWidth={1.5} strokeDasharray="4 4" />;
              })}
              <g>
                <circle cx={0} cy={0} r={42} className="fill-primary" />
                <text x={0} y={7} textAnchor="middle" className="fill-primary-foreground" style={{ fontSize: 22, fontWeight: 700 }}>You</text>
              </g>
              {layout.companies.map(co => (
                <g key={'c-' + co.name}>
                  <rect x={co.x - 80} y={co.y - 21} width={160} height={42} rx={21} className="fill-secondary stroke-primary/60" strokeWidth={2} />
                  <text x={co.x} y={co.y + 6} textAnchor="middle" className="fill-foreground" style={{ fontSize: 16, fontWeight: 700 }}>
                    {co.name.length > 17 ? co.name.slice(0, 16) + '…' : co.name}
                  </text>
                </g>
              ))}
              {layout.people.map(p => (
                <g key={'p-' + p.contact.id} role="button" tabIndex={0} aria-label={p.contact.name} className="cursor-pointer"
                  onClick={() => setShowing(p.contact)} onKeyDown={e => { if (e.key === 'Enter') setShowing(p.contact); }}>
                  <circle cx={p.x} cy={p.y} r={32} className="fill-card stroke-primary" strokeWidth={2.5} />
                  <text x={p.x} y={p.y + 11} textAnchor="middle" style={{ fontSize: 32 }}>{p.contact.emoji || '🙂'}</text>
                  <text x={p.x} y={p.y + 54} textAnchor="middle" className="fill-foreground" style={{ fontSize: 16, fontWeight: 600 }}>
                    {p.contact.name.length > 16 ? p.contact.name.slice(0, 15) + '…' : p.contact.name}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        )}

        {contacts.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Everyone</p>
            {[...contacts].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
              <button key={c.id} type="button" onClick={() => setShowing(c)} className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-secondary/40">
                <span className="text-2xl leading-none">{c.emoji || '🙂'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{[c.role, c.company].filter(Boolean).join(' · ') || 'Independent'}</span>
                </span>
              </button>
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
                <Button className="flex-1" onClick={save}>Save</Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </SpacePageWrapper>
  );
}
