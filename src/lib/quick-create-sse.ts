import {
  parseQuickCreateCompileSseEvent,
  type QuickCreateCompileSseEvent,
} from '@/lib/quick-create-compile';

export interface ParsedQuickCreateSseChunk {
  events: QuickCreateCompileSseEvent[];
  buffer: string;
}

function parseEventBlock(block: string): QuickCreateCompileSseEvent | null {
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  if (dataLines.length === 0) return null;

  const rawData = dataLines.join('\n');
  try {
    return parseQuickCreateCompileSseEvent(JSON.parse(rawData) as unknown);
  } catch {
    throw new Error('快速创作服务返回了无法解析的 SSE 事件');
  }
}

export function parseQuickCreateSseChunk(buffer: string, chunk: string): ParsedQuickCreateSseChunk {
  const normalized = `${buffer}${chunk}`.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const remainingBuffer = blocks.pop() ?? '';
  const events = blocks
    .map((block: string) => parseEventBlock(block))
    .filter((event: QuickCreateCompileSseEvent | null): event is QuickCreateCompileSseEvent => event !== null);

  return { events, buffer: remainingBuffer };
}

export function flushQuickCreateSseBuffer(buffer: string): QuickCreateCompileSseEvent[] {
  const trimmed = buffer.trim();
  if (!trimmed) return [];
  const event = parseEventBlock(trimmed);
  return event ? [event] : [];
}
