import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import MilestoneOverlay from '@/components/MilestoneOverlay';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  MapPin, Utensils, Music, Gamepad2, Clock, Sparkles, Heart,
  Coffee, Pizza, Beer, Popcorn, Dumbbell, TreePine, Palette,
  RefreshCw, Search,
} from 'lucide-react';
import { startOfWeek, endOfWeek, isWithinInterval, parseISO } from 'date-fns';

type Category = 'all' | 'food' | 'events' | 'casual';

interface Suggestion {
  id: string;
  name: string;
  category: Category;
  vibe: string;
  icon: typeof Utensils;
  time: string;
  description: string;
  tags: string[];
  color: string;
}

const SUGGESTION_POOL: Omit<Suggestion, 'id'>[] = [
  { name: 'Late Night Ramen', category: 'food', vibe: '🍜 Cozy', icon: Utensils, time: 'Open til 2am', description: 'Nothing beats a warm bowl after a long shift. Broth heals everything.', tags: ['Late Night', 'Comfort Food'], color: 'from-blue-500/20 to-purple-500/20' },
  { name: 'Craft Cocktail Spot', category: 'food', vibe: '🍸 Chill', icon: Beer, time: 'Happy Hour til 9pm', description: 'Unwind with creative cocktails in a dimly lit, no-rush atmosphere.', tags: ['Drinks', 'Vibes'], color: 'from-violet-500/20 to-purple-500/20' },
  { name: 'Rooftop Pizza', category: 'food', vibe: '🍕 Views', icon: Pizza, time: 'Open til midnight', description: 'Wood-fired pizza with city skyline views. Bring someone special.', tags: ['Date Night', 'Scenic'], color: 'from-yellow-500/20 to-lime-500/20' },
  { name: 'Coffee & Vinyl Shop', category: 'casual', vibe: '☕ Mellow', icon: Coffee, time: 'Open til 10pm', description: 'Sip a pour-over while flipping through records. Peak decompression.', tags: ['Chill', 'Music'], color: 'from-amber-600/20 to-yellow-500/20' },
  { name: 'Comedy Open Mic', category: 'events', vibe: '😂 Fun', icon: Music, time: 'Starts 8pm', description: 'Laugh off the work stress. Some nights you become the show.', tags: ['Live', 'Free Entry'], color: 'from-pink-500/20 to-rose-500/20' },
  { name: 'Indie Live Music', category: 'events', vibe: '🎵 Groovy', icon: Music, time: 'Doors 7pm', description: 'Local bands, good energy, no pretension. Just vibes.', tags: ['Live Music', 'Local'], color: 'from-indigo-500/20 to-blue-500/20' },
  { name: 'Retro Arcade Bar', category: 'casual', vibe: '🕹️ Nostalgic', icon: Gamepad2, time: 'Open til 1am', description: 'Pac-Man, pinball, and cold drinks. Adult recess.', tags: ['Games', 'Nightlife'], color: 'from-cyan-500/20 to-teal-500/20' },
  { name: 'Night Hike Trail', category: 'casual', vibe: '🌙 Peaceful', icon: TreePine, time: 'Best after sunset', description: 'Clear your head under the stars. Headlamp recommended.', tags: ['Outdoors', 'Free'], color: 'from-green-500/20 to-emerald-500/20' },
  { name: 'Bowling Alley', category: 'casual', vibe: '🎳 Classic', icon: Dumbbell, time: 'Open til midnight', description: 'Glow-in-the-dark lanes, nachos, and zero pressure to be good.', tags: ['Group Fun', 'Classic'], color: 'from-blue-500/20 to-indigo-500/20' },
  { name: 'Art Gallery Opening', category: 'events', vibe: '🎨 Inspiring', icon: Palette, time: 'Free entry 6-9pm', description: 'Free wine, interesting people, actual culture. Good for the soul.', tags: ['Free', 'Culture'], color: 'from-fuchsia-500/20 to-pink-500/20' },
  { name: 'Late Movie Screening', category: 'casual', vibe: '🎬 Escape', icon: Popcorn, time: 'Shows after 10pm', description: 'Empty theater, big screen, total escapism. Butter that popcorn.', tags: ['Solo-friendly', 'Relaxing'], color: 'from-slate-500/20 to-zinc-500/20' },
  { name: 'Food Truck Park', category: 'food', vibe: '🌮 Eclectic', icon: Utensils, time: 'Open til 11pm', description: 'Tacos, BBQ, fusion bowls — sample everything. Outdoor seating.', tags: ['Casual', 'Variety'], color: 'from-lime-500/20 to-green-500/20' },
];

const categoryIcons: Record<Category, typeof Utensils> = {
  all: Sparkles,
  food: Utensils,
  events: Music,
  casual: Gamepad2,
};

const categoryLabels: Record<Category, string> = {
  all: 'All Vibes',
  food: 'Food & Drinks',
  events: 'Live Events',
  casual: 'Casual Fun',
};

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const item = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, damping: 20 } },
};

export default function DiscoverPage() {
  const { data } = useData();
  const [category, setCategory] = useState<Category>('all');
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [shuffleKey, setShuffleKey] = useState(0);

  // Compute weekly stats for milestone triggers
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  const weeklyStats = useMemo(() => {
    const weekJobs = data.jobs.filter(j => {
      try {
        return isWithinInterval(parseISO(j.date), { start: weekStart, end: weekEnd });
      } catch { return false; }
    });
    const hours = weekJobs.reduce((s, j) => s + (j.hoursWorked || 0), 0);
    const earnings = weekJobs.reduce((s, j) => s + (j.hoursWorked || 0) * (j.hourlyRate || 0), 0);
    return { hours, earnings };
  }, [data.jobs, weekStart.toISOString(), weekEnd.toISOString()]);

  // Get unique venues + cities from jobs
  const venues = useMemo(() => {
    const v = new Set(data.jobs.map(j => j.venue).filter(Boolean));
    return Array.from(v);
  }, [data.jobs]);

  // Try to extract city-ish tokens from venue names (last word or common city keywords)
  const suggestedAreas = useMemo(() => {
    const areas = new Set<string>();
    data.jobs.forEach(j => {
      // venue like "Convention Center Philadelphia" → "Philadelphia"
      // or client city hints
      [j.venue, j.client].forEach(s => {
        if (!s) return;
        const words = s.split(/[\s,]+/);
        // Grab last capitalized word that looks like a city (>3 chars, not all-caps)
        const last = words.reverse().find(w => w.length > 3 && /^[A-Z][a-z]/.test(w));
        if (last) areas.add(last);
      });
    });
    return Array.from(areas).slice(0, 6);
  }, [data.jobs]);

  const [citySearch, setCitySearch] = useState('');
  const [selectedVenue, setSelectedVenue] = useState<string>('');

  const activeArea = citySearch.trim() || selectedVenue;

  // Shuffle and filter suggestions
  const suggestions = useMemo(() => {
    const pool = category === 'all'
      ? [...SUGGESTION_POOL]
      : SUGGESTION_POOL.filter(s => s.category === category);

    // Simple shuffle based on shuffleKey
    const shuffled = pool
      .map((s, i) => ({ ...s, id: `${s.name}-${shuffleKey}-${i}`, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, 8);

    return shuffled as Suggestion[];
  }, [category, shuffleKey]);

  const toggleLike = (id: string) => {
    setLiked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="pb-24">
      <MilestoneOverlay weeklyHours={weeklyStats.hours} weeklyEarnings={weeklyStats.earnings} />

      <PageHeader
        title="Discover"
        description={activeArea ? `things to do near ${activeArea}` : 'find something fun after work'}
      />

      {/* City / area search */}
      <div className="mb-4 space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={citySearch}
            onChange={e => setCitySearch(e.target.value)}
            placeholder="search by city or neighborhood..."
            className="w-full h-9 pl-8 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
        {suggestedAreas.length > 0 && !citySearch && (
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-[9px] text-mono text-muted-foreground/40 uppercase tracking-widest self-center">from your jobs:</span>
            {suggestedAreas.map(area => (
              <button
                key={area}
                onClick={() => setCitySearch(area)}
                className="rounded-full border border-border bg-secondary/30 px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
              >
                {area}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Weekly Progress Bar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">This week</span>
          <span className="text-mono font-semibold text-foreground">
            {weeklyStats.hours.toFixed(1)}h · ${weeklyStats.earnings.toFixed(0)}
          </span>
        </div>
        <div className="relative h-3 rounded-full bg-secondary overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-info via-accent to-success"
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((weeklyStats.hours / 40) * 100, 100)}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
          {weeklyStats.hours >= 40 && (
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-info/20 via-accent/30 to-success/20"
              animate={{ opacity: [0.3, 0.7, 0.3] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
          )}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>0h</span>
          <span className={weeklyStats.hours >= 40 ? 'text-success font-semibold' : ''}>
            40h {weeklyStats.hours >= 40 ? '✓' : ''}
          </span>
        </div>
      </motion.div>

      {/* Venue selector + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {venues.length > 0 && (
          <Select value={selectedVenue} onValueChange={v => { setSelectedVenue(v); setCitySearch(''); }}>
            <SelectTrigger className="sm:w-56">
              <MapPin size={14} className="mr-1 text-primary shrink-0" />
              <SelectValue placeholder="pick a venue" />
            </SelectTrigger>
            <SelectContent>
              {venues.map(v => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex gap-2 flex-wrap flex-1">
          {(Object.keys(categoryLabels) as Category[]).map(cat => {
            const Icon = categoryIcons[cat];
            const active = category === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? 'bg-primary/15 text-primary border border-primary/30 shadow-sm'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80 border border-transparent'
                }`}
              >
                <Icon size={13} />
                {categoryLabels[cat]}
              </button>
            );
          })}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShuffleKey(k => k + 1)}
          className="shrink-0"
        >
          <RefreshCw size={16} />
        </Button>
      </div>

      {/* Suggestion Grid */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${category}-${shuffleKey}`}
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          {suggestions.map((s) => (
            <motion.div key={s.id} variants={item} layout>
              <Card className="group relative overflow-hidden border-border hover:border-primary/20 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5">
                <div className={`absolute inset-0 bg-gradient-to-br ${s.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                <CardContent className="relative p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <motion.div
                        whileHover={{ rotate: [0, -10, 10, 0], scale: 1.1 }}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary"
                      >
                        <s.icon size={18} className="text-primary" />
                      </motion.div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-sm text-foreground truncate">{s.name}</h3>
                        <p className="text-xs text-muted-foreground">{s.vibe}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleLike(s.id)}
                      className="shrink-0 p-1 transition-transform active:scale-90"
                    >
                      <motion.div
                        animate={liked.has(s.id) ? { scale: [1, 1.3, 1] } : {}}
                        transition={{ duration: 0.3 }}
                      >
                        <Heart
                          size={18}
                          className={liked.has(s.id) ? 'fill-destructive text-destructive' : 'text-muted-foreground'}
                        />
                      </motion.div>
                    </button>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                    {s.description}
                  </p>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock size={12} />
                      {s.time}
                    </div>
                    <div className="flex gap-1.5">
                      {s.tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>

      {suggestions.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 text-muted-foreground"
        >
          <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p className="text-sm">No suggestions in this category yet.</p>
        </motion.div>
      )}
    </div>
  );
}
