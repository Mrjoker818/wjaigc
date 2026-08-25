export interface SimpleChatSseEvent {
  data: string;
  event?: string;
  id?: string;
}

export interface ConsumeSimpleChatJsonStreamOptions {
  onEvent: (value: unknown) => void | Promise<void>;
  isActive?: () => boolean;
}

export class SimpleChatSseProtocolError extends Error {
  readonly code = 'SIMPLE_CHAT_SSE_MALFORMED' as const;
  readonly preview: string;

  constructor(rawData: string) {
    super('流式响应格式异常，请重试。');
    this.name = 'SimpleChatSseProtocolError';
    this.preview = rawData.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
  }
}

export class SimpleChatSseDecoder {
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private dataLines: string[] = [];
  private eventName: string | undefined;
  private eventId: string | undefined;
  private finished = false;

  push(chunk: Uint8Array): SimpleChatSseEvent[] {
    if (this.finished) {
      throw new Error('SimpleChatSseDecoder has already finished');
    }
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish(): SimpleChatSseEvent[] {
    if (this.finished) return [];
    this.finished = true;
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): SimpleChatSseEvent[] {
    const events: SimpleChatSseEvent[] = [];

    while (this.buffer.length > 0) {
      const lineEnd = this.findLineEnd();
      if (lineEnd === -1) {
        if (final) {
          this.processLine(this.buffer, events);
          this.buffer = '';
        }
        break;
      }

      const terminator = this.buffer[lineEnd];
      if (!final && terminator === '\r' && lineEnd === this.buffer.length - 1) {
        break;
      }

      const line = this.buffer.slice(0, lineEnd);
      const terminatorLength = terminator === '\r' && this.buffer[lineEnd + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(lineEnd + terminatorLength);
      this.processLine(line, events);
    }

    if (final) this.dispatch(events);
    return events;
  }

  private findLineEnd(): number {
    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character === '\n' || character === '\r') return index;
    }
    return -1;
  }

  private processLine(line: string, events: SimpleChatSseEvent[]): void {
    if (line === '') {
      this.dispatch(events);
      return;
    }
    if (line.startsWith(':')) return;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') {
      this.dataLines.push(value);
    } else if (field === 'event') {
      this.eventName = value;
    } else if (field === 'id' && !value.includes('\0')) {
      this.eventId = value;
    }
  }

  private dispatch(events: SimpleChatSseEvent[]): void {
    if (this.dataLines.length > 0) {
      const event: SimpleChatSseEvent = { data: this.dataLines.join('\n') };
      if (this.eventName !== undefined) event.event = this.eventName;
      if (this.eventId !== undefined) event.id = this.eventId;
      events.push(event);
    }
    this.dataLines = [];
    this.eventName = undefined;
    this.eventId = undefined;
  }
}

async function dispatchJsonEvents(
  events: SimpleChatSseEvent[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: ConsumeSimpleChatJsonStreamOptions,
): Promise<'continue' | 'completed' | 'cancelled'> {
  for (const event of events) {
    if (options.isActive && !options.isActive()) {
      await reader.cancel();
      return 'cancelled';
    }

    const data = event.data.trim();
    if (!data) continue;
    if (data === '[DONE]') {
      await reader.cancel();
      return 'completed';
    }

    let value: unknown;
    try {
      value = JSON.parse(data) as unknown;
    } catch {
      throw new SimpleChatSseProtocolError(data);
    }
    await options.onEvent(value);
  }
  return 'continue';
}

export async function consumeSimpleChatJsonStream(
  stream: ReadableStream<Uint8Array>,
  options: ConsumeSimpleChatJsonStreamOptions,
): Promise<'completed' | 'cancelled'> {
  const reader = stream.getReader();
  const decoder = new SimpleChatSseDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        const result = await dispatchJsonEvents(decoder.finish(), reader, options);
        return result === 'cancelled' ? 'cancelled' : 'completed';
      }
      if (options.isActive && !options.isActive()) {
        await reader.cancel();
        return 'cancelled';
      }

      const result = await dispatchJsonEvents(decoder.push(value), reader, options);
      if (result !== 'continue') return result;
    }
  } finally {
    reader.releaseLock();
  }
}
