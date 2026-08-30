import { useState, useRef } from 'react';

export function useVoiceInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);

  const supported = typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const start = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const text: string = e.results[0]?.[0]?.transcript ?? '';
      if (text) onResult(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const stop = () => {
    recRef.current?.stop();
    setListening(false);
  };

  return { listening, supported, start, stop };
}

// ── Parsers ────────────────────────────────────────────────────────────────

export function parseIncomeSpeech(text: string): { amount?: number; client?: string; date?: string } {
  const t = text.toLowerCase();
  // Amount: "$345", "345 dollars", "three hundred..." (Chrome usually converts to digits)
  const amtMatch = t.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|bucks?)/);
  const amount = amtMatch
    ? parseFloat(amtMatch[1] ?? amtMatch[2])
    : (() => { const m = t.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : undefined; })();

  // Relative date words can land anywhere in the transcript (e.g. "from
  // panitechnics yesterday") — pull them out and compute the actual date
  // before parsing the client name, so they don't get swallowed into it.
  let date: string | undefined;
  let cleaned = t;
  const dateWordMatch = t.match(/\b(yesterday|today|tomorrow)\b/);
  if (dateWordMatch) {
    const offset = dateWordMatch[1] === 'yesterday' ? -1 : dateWordMatch[1] === 'tomorrow' ? 1 : 0;
    const d = new Date();
    d.setDate(d.getDate() + offset);
    date = d.toISOString().split('T')[0];
    cleaned = t.replace(dateWordMatch[0], '').trim();
  }

  // Client: after "from"
  const fromMatch = cleaned.match(/from\s+([a-z][^,\n]+?)(?:\s+(?:on|for|this|at)\b|$)/i);
  const client = fromMatch ? fromMatch[1].trim() : undefined;

  return { amount, client, date };
}

const CATEGORY_KEYWORDS: [string[], string][] = [
  [['fuel', 'gas', 'petrol', 'diesel'],           'Fuel'],
  [['food', 'meal', 'lunch', 'dinner', 'breakfast', 'coffee', 'pizza', 'tacos', 'restaurant'], 'Meals'],
  [['hotel', 'motel', 'airbnb', 'lodging', 'stay', 'room'],  'Lodging'],
  [['flight', 'uber', 'lyft', 'taxi', 'travel', 'train', 'bus', 'parking'],  'Travel'],
  [['gear', 'equipment', 'rental', 'rent'],        'Gear Rental'],
  [['union', 'dues', 'iatse'],                     'IATSE Union Dues'],
  [['software', 'subscription', 'app', 'adobe'],   'Software'],
  [['tool', 'cable', 'supply', 'supplies'],        'Tools'],
  [['insurance'],                                  'Insurance'],
];

export function parseExpenseSpeech(text: string): { amount?: number; description?: string; category?: string } {
  const t = text.toLowerCase();
  const amtMatch = t.match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|bucks?)/);
  const amount = amtMatch
    ? parseFloat(amtMatch[1] ?? amtMatch[2])
    : (() => { const m = t.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : undefined; })();

  // Description: after "on" or "for"
  const onMatch = t.match(/(?:\bon\b|\bfor\b)\s+([a-z][^,\n]+?)(?:\s+(?:today|on|at|this|last)\b|$)/i);
  const description = onMatch ? onMatch[1].trim() : undefined;

  // Auto-detect category
  const search = (description ?? t);
  let category: string | undefined;
  for (const [keywords, cat] of CATEGORY_KEYWORDS) {
    if (keywords.some(k => search.includes(k))) { category = cat; break; }
  }

  return { amount, description, category };
}
