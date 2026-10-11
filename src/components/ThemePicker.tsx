import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The four gels. Each is one base colour; every surface, edge and dim text in
 * the app derives from it in CSS, so switching is a single attribute on <html>
 * and nothing here needs to know what any of those surfaces are.
 *
 * swatch is only for the buttons below — the real colour comes from index.css.
 */
export const THEMES = [
  { id: '', name: 'Electric Blue', swatch: '#1a2bd4' },
  { id: 'violet', name: 'Deep Violet', swatch: '#5c21bd' },
  { id: 'green', name: 'Chroma Green', swatch: '#3f4714' },
  { id: 'gunmetal', name: 'Gunmetal', swatch: '#3a434a' },
] as const;

const STORAGE_KEY = 'showflow-theme';

/** The saved gel, or the default when nothing has been chosen or storage is unreadable. */
export function loadTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.some(t => t.id === saved) ? saved! : '';
  } catch {
    return '';
  }
}

/**
 * Put the gel on <html>. Called at startup before React paints, so the app
 * never flashes the default colour on the way to the chosen one.
 */
export function applyTheme(id: string) {
  if (id) document.documentElement.setAttribute('data-theme', id);
  else document.documentElement.removeAttribute('data-theme');
}

export default function ThemePicker() {
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private window or storage blocked — the colour still applies for now.
    }
  }, [theme]);

  return (
    <section>
      <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase mb-3">
        Colour
      </p>
      <div className="grid grid-cols-2 gap-2">
        {THEMES.map(({ id, name, swatch }) => {
          const active = theme === id;
          return (
            <button
              key={id || 'default'}
              type="button"
              aria-pressed={active}
              onClick={() => setTheme(id)}
              className={cn(
                'pixel-button flex items-center gap-2.5 p-2.5 text-left',
                active ? 'bg-primary/15 border-primary' : 'bg-card hover:bg-secondary/40',
              )}
            >
              <span
                aria-hidden="true"
                className="h-7 w-7 shrink-0 border border-border"
                style={{ background: swatch }}
              />
              <span className="min-w-0">
                <span className={cn('block text-xs font-bold truncate', active && 'text-primary')}>{name}</span>
                <span className="block text-[9px] text-mono uppercase tracking-wider text-muted-foreground">
                  {active ? 'In use' : 'Tap to use'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
