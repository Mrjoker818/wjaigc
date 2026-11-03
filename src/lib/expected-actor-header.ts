const ACTOR_HEADER = 'x-wujie-expected-actor-id';
const ENCODING_HEADER = 'x-wujie-expected-actor-id-encoding';
const UTF8_ENCODING = 'percent-utf8';

export function expectedActorHeaders(actorId: string): Record<string, string> {
  if (/^[\x21-\x7e]+$/.test(actorId)) return { [ACTOR_HEADER]: actorId };
  return { [ACTOR_HEADER]: encodeURIComponent(actorId), [ENCODING_HEADER]: UTF8_ENCODING };
}

export function readExpectedActor(headers: Headers):
  | { status: 'absent' | 'invalid' }
  | { status: 'present'; actorId: string } {
  const value = headers.get(ACTOR_HEADER);
  const encoding = headers.get(ENCODING_HEADER);
  if (value === null) return { status: encoding === null ? 'absent' : 'invalid' };
  if (encoding === null) return { status: 'present', actorId: value };
  if (encoding !== UTF8_ENCODING) return { status: 'invalid' };
  if (value.length === 0) return { status: 'invalid' };
  try {
    return { status: 'present', actorId: decodeURIComponent(value) };
  } catch {
    return { status: 'invalid' };
  }
}
