'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { activeMention, filterCandidates, insertMention, type MentionCandidate } from '@/lib/drama/mentions';

/**
 * Textarea that suggests cast and prop names after `@`. Arrow keys move through the list,
 * Enter or Tab inserts, Escape closes. Picking a name also reports it so the shot can link it.
 */
export function MentionTextarea({ value, onChange, onMention, candidates, className, maxLength, placeholder, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  onMention?: (candidate: MentionCandidate) => void;
  candidates: MentionCandidate[];
  className?: string;
  maxLength?: number;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const options = mention ? filterCandidates(candidates, mention.query) : [];
  const open = options.length > 0;

  const track = (text: string, caret: number) => {
    const next = activeMention(text, caret);
    setMention(next);
    if (next?.query !== mention?.query) setActive(0);
  };

  const pick = (candidate: MentionCandidate) => {
    const element = ref.current;
    if (!element || !mention) return;
    const result = insertMention(value, mention.start, element.selectionStart, candidate.name);
    onChange(result.text);
    onMention?.(candidate);
    setMention(null);
    // Put the caret after the inserted name once React has written the new value.
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(result.caret, result.caret); });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => (i + 1) % options.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => (i - 1 + options.length) % options.length); }
    else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); pick(options[Math.min(active, options.length - 1)]); }
    else if (event.key === 'Escape') { event.preventDefault(); setMention(null); }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref} className={className} maxLength={maxLength} placeholder={placeholder} value={value}
        aria-label={ariaLabel} aria-autocomplete="list" aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={event => { onChange(event.target.value); track(event.target.value, event.target.selectionStart); }}
        onKeyDown={onKeyDown}
        onClick={event => track(value, event.currentTarget.selectionStart)}
        onBlur={() => setMention(null)}
      />
      {open ? (
        <ul id={listId} role="listbox" aria-label="插入角色或道具"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--drama-line)] bg-[var(--drama-panel)] py-1 shadow-xl">
          {options.map((candidate, i) => (
            <li key={`${candidate.kind}:${candidate.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm ${i === active ? 'bg-[var(--drama-ink)] text-[var(--drama-gold)]' : ''}`}
              // mousedown keeps focus in the textarea so blur does not close the list first.
              onMouseDown={event => { event.preventDefault(); pick(candidate); }}
              onMouseEnter={() => setActive(i)}>
              <span className="rounded border border-[var(--drama-line)] px-1 font-mono text-[11px] text-[var(--drama-muted)]">
                {candidate.kind === 'character' ? '角色' : '道具'}
              </span>
              {candidate.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
