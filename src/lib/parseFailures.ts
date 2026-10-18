import { supabase } from '@/integrations/supabase/client';

/**
 * A record of every time the parser got it wrong, kept so the prompt and the
 * fixtures can be fixed rather than the failure just being retried away.
 *
 * Two kinds matter, and the second is the one that used to vanish:
 *  - 'error'   the model threw, or returned nothing at all.
 *  - 'retry'   it came back, you did not believe it, and asked a smarter model.
 *  - 'misread' it came back and was wrong — the kind that silently costs a
 *              shift, because nothing errored and nothing looked broken.
 *
 * Logging never throws and never blocks. A failed log about a failed parse is
 * not worth interrupting anyone over.
 */
export type ParseFailureKind = 'error' | 'retry' | 'misread';

export interface ParseFailureInput {
  source: 'smart-import' | 'parse-jobs';
  kind: ParseFailureKind;
  /** The text that beat it — this is what makes it fixable later. */
  inputText?: string;
  model?: string;
  effort?: string;
  classifiedAs?: string;
  resultCount?: number;
  errorMessage?: string;
}

/** The longest excerpt worth keeping. A whole month's paste is not evidence. */
const MAX_TEXT = 4000;

export async function logParseFailure(input: ParseFailureInput): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    // Signed out there is nowhere to put it, and no RLS row to own it.
    if (!user) return;

    await supabase.from('parse_failures').insert({
      user_id: user.id,
      source: input.source,
      kind: input.kind,
      input_text: input.inputText?.slice(0, MAX_TEXT) ?? null,
      model: input.model ?? null,
      effort: input.effort ?? null,
      classified_as: input.classifiedAs ?? null,
      result_count: input.resultCount ?? null,
      error_message: input.errorMessage ?? null,
    } as never);
  } catch {
    // Deliberately silent. This is diagnostics about a problem the user is
    // already looking at; a second error on top helps nobody.
  }
}
