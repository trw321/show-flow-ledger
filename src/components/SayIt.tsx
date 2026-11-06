import { useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useVoiceInput } from '@/lib/useVoiceInput';
import { cn } from '@/lib/utils';

/**
 * Say it or type it, in one box. The mic needs a browser that does speech
 * recognition, and most on an iPhone don't, so the box is always here: the
 * keyboard's own dictation key fills it just the same.
 */
export default function SayIt({ label, placeholder, examples, onSay }: {
  label: string;
  placeholder: string;
  /** Things to try, in a line. */
  examples: string;
  onSay: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const { listening, supported, failed, start, stop } = useVoiceInput(heard => { setText(heard); onSay(heard); });
  return (
    <form
      className="pixel-panel space-y-1.5 p-2.5"
      onSubmit={e => { e.preventDefault(); if (text.trim()) onSay(text.trim()); }}
    >
      <div className="flex items-center gap-1.5">
        {supported && (
          <button
            type="button"
            onClick={listening ? stop : start}
            aria-label={listening ? 'Stop listening' : 'Say it'}
            className={cn('pixel-button flex h-9 w-9 shrink-0 items-center justify-center', listening ? 'bg-destructive/15 text-destructive animate-pulse' : 'pick-off')}
          >
            {listening ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
        )}
        <Input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          enterKeyHint="go"
          autoComplete="off"
          className="h-9 min-w-0 flex-1 text-sm"
        />
        <button type="submit" disabled={!text.trim()} className="pixel-button pick-on h-9 shrink-0 px-3 text-xs font-bold disabled:opacity-40">Go</button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {listening ? 'Listening…' : failed ? "This browser's mic won't run. Tap the box and use the mic on your keyboard." : `${examples}${supported ? '' : ' Use the mic on your keyboard to say it.'}`}
      </p>
    </form>
  );
}
