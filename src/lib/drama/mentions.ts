/** `@角色` / `@道具` mentions in shot prompts: autocomplete helpers and resolution to cast and prop ids. */
import type { DramaProjectV1 } from './types';

export interface MentionCandidate {
  kind: 'character' | 'prop';
  id: string;
  name: string;
}

/** Cast first, then props; nameless entries cannot be typed and are left out. */
export function mentionCandidates(doc: Pick<DramaProjectV1, 'cast' | 'props'>): MentionCandidate[] {
  return [
    ...doc.cast.map(member => ({ kind: 'character' as const, id: member.id, name: member.name.trim() })),
    ...doc.props.map(prop => ({ kind: 'prop' as const, id: prop.id, name: prop.name.trim() })),
  ].filter(candidate => candidate.name.length > 0);
}

// Longest names first so "@林辰辰" is not read as "@林辰" followed by "辰".
function byLength(candidates: MentionCandidate[]): MentionCandidate[] {
  return [...candidates].sort((a, b) => b.name.length - a.name.length);
}

function mentionedCandidates(text: string, candidates: MentionCandidate[]): MentionCandidate[] {
  const found = new Map<string, MentionCandidate>();
  const sorted = byLength(candidates);
  for (let at = text.indexOf('@'); at >= 0; at = text.indexOf('@', at + 1)) {
    const match = sorted.find(candidate => text.startsWith(candidate.name, at + 1));
    if (match) found.set(`${match.kind}:${match.id}`, match);
  }
  return [...found.values()];
}

/** Cast and prop ids named with `@` in the text, in order of first mention. */
export function resolveMentions(text: string, doc: Pick<DramaProjectV1, 'cast' | 'props'>): { characterIds: string[]; propIds: string[] } {
  const found = mentionedCandidates(text, mentionCandidates(doc));
  return {
    characterIds: found.filter(item => item.kind === 'character').map(item => item.id),
    propIds: found.filter(item => item.kind === 'prop').map(item => item.id),
  };
}

/** The text with `@` removed before known names, so the model reads plain names. Unknown `@` stays. */
export function stripMentions(text: string, doc: Pick<DramaProjectV1, 'cast' | 'props'>): string {
  const sorted = byLength(mentionCandidates(doc));
  if (!sorted.length) return text;
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '@' && sorted.some(candidate => text.startsWith(candidate.name, i + 1))) continue;
    out += text[i];
  }
  return out;
}

/** Adds ids named in the prompt to the shot's lists. Never removes: the inspector toggles do that. */
export function mergeMentionIds(
  shot: { characterIds?: string[]; propIds?: string[] }, text: string, doc: Pick<DramaProjectV1, 'cast' | 'props'>,
): { characterIds?: string[]; propIds?: string[] } {
  const named = resolveMentions(text, doc);
  const merge = (current: string[] | undefined, extra: string[]) => {
    const missing = extra.filter(id => !(current ?? []).includes(id));
    return missing.length ? [...(current ?? []), ...missing] : current;
  };
  return { characterIds: merge(shot.characterIds, named.characterIds), propIds: merge(shot.propIds, named.propIds) };
}

/** The `@query` being typed at the caret, or null when the caret is not inside one. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (/[\s，。！？、,.!?；;：:]/u.test(query) || query.length > 20) return null;
  return { start: at, query };
}

export function filterCandidates(candidates: MentionCandidate[], query: string, limit = 8): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  return candidates.filter(candidate => candidate.name.toLowerCase().includes(q)).slice(0, limit);
}

/** Replaces the `@query` at `start` with `@name ` and returns the new text and caret. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}
