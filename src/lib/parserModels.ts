// Mirrors the safelist in supabase/functions/_shared/lovable-ai.ts. The edge
// functions can't be imported here (Deno), so the list is duplicated — keep
// the two in step when adding a model.
//
// Deliberately short. The API exposes ~130 models, but nearly all are speech,
// transcription, embedding or image-generation models that cannot read a
// document and return a strict tool call at all.

export interface ParserModel {
  id: string;
  label: string;
  note: string;
  /** gpt-5.x can think before answering; older models have no effort setting. */
  reasoning: boolean;
}

export const PARSER_MODELS: ParserModel[] = [
  { id: 'gpt-4o', label: 'GPT-4o', note: 'Default. Fastest, proven on current formats.', reasoning: false },
  { id: 'gpt-4.1', label: 'GPT-4.1', note: 'Newer non-reasoning model.', reasoning: false },
  { id: 'gpt-5', label: 'GPT-5', note: 'First of the 5 series.', reasoning: true },
  { id: 'gpt-5.4', label: 'GPT-5.4', note: 'Stable 5.x.', reasoning: true },
  { id: 'gpt-5.5', label: 'GPT-5.5', note: 'Stable 5.x.', reasoning: true },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', note: 'Newest. Best on unusual formats.', reasoning: true },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', note: 'Newest series, sibling of Sol.', reasoning: true },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', note: 'Newest series, sibling of Sol.', reasoning: true },
];

export const REASONING_EFFORTS = [
  { id: 'none', label: 'None', note: 'No thinking. Fastest.' },
  { id: 'low', label: 'Low', note: 'A little thinking.' },
  { id: 'medium', label: 'Medium', note: 'Slower, better on messy text.' },
  { id: 'high', label: 'High', note: 'Slowest. For formats nothing else reads.' },
] as const;

export type ReasoningEffort = typeof REASONING_EFFORTS[number]['id'];

export const DEFAULT_MODEL = 'gpt-4o';
export const DEFAULT_EFFORT: ReasoningEffort = 'none';

const MODEL_KEY = 'showflow-parser-model';
const EFFORT_KEY = 'showflow-parser-effort';

export const supportsReasoning = (id: string) => PARSER_MODELS.find(m => m.id === id)?.reasoning ?? false;

// Stored per device rather than in app data — it's a preference about how to
// parse, not part of the ledger, and it must never wedge the app if unreadable.
export function loadParserChoice(): { model: string; effort: ReasoningEffort } {
  try {
    const model = localStorage.getItem(MODEL_KEY) ?? DEFAULT_MODEL;
    const effort = (localStorage.getItem(EFFORT_KEY) as ReasoningEffort) ?? DEFAULT_EFFORT;
    return {
      model: PARSER_MODELS.some(m => m.id === model) ? model : DEFAULT_MODEL,
      effort: REASONING_EFFORTS.some(e => e.id === effort) ? effort : DEFAULT_EFFORT,
    };
  } catch {
    return { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT };
  }
}

export function saveParserChoice(model: string, effort: ReasoningEffort) {
  try {
    localStorage.setItem(MODEL_KEY, model);
    localStorage.setItem(EFFORT_KEY, effort);
  } catch { /* storage full or blocked — the choice just won't persist */ }
}
