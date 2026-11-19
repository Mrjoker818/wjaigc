import { SearchClient, Config } from 'coze-coding-dev-sdk';

/**
 * Web search for the standalone chat, used for the search before the first model call and for
 * the web_search tool the model may call afterwards. Ported from stable 3eb5958b with source
 * links limited to http(s) and numbering that continues across searches in one turn.
 */

export interface WebSearchSource {
  index: number;
  title: string;
  url: string;
  snippet: string;
  summary?: string;
}

export interface WebSearchOutcome {
  ok: boolean;
  query: string;
  sources: WebSearchSource[];
  summary?: string;
  error?: string;
}

/** The chat client parses one line per field, so provider text must not carry line breaks. */
function oneLine(value: string | undefined): string {
  return (value || '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** Only plain http(s) links without credentials are shown as clickable sources. */
export function safeSourceUrl(value: string | undefined): string {
  const trimmed = oneLine(value);
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password) {
      return trimmed;
    }
  } catch { /* not a URL */ }
  return '';
}

export async function runWebSearch(
  query: string,
  customHeaders: Record<string, string> | undefined,
  options: { startIndex?: number; limit?: number } = {},
): Promise<WebSearchOutcome> {
  const trimmed = oneLine(query).slice(0, 500);
  if (!trimmed) return { ok: false, query: '', sources: [], error: '搜索关键词为空' };
  const startIndex = options.startIndex ?? 1;
  const limit = options.limit ?? 5;
  try {
    const client = new SearchClient(new Config(), customHeaders);
    const response = await client.webSearch(trimmed, limit, true);
    const sources = (response.web_items || []).slice(0, limit).map((item, i) => ({
      index: startIndex + i,
      title: oneLine(item.title) || '未命名结果',
      url: safeSourceUrl(item.url),
      snippet: oneLine(item.snippet),
      ...(item.summary ? { summary: oneLine(item.summary) } : {}),
    }));
    return { ok: true, query: trimmed, sources, ...(response.summary ? { summary: response.summary } : {}) };
  } catch (error: unknown) {
    return {
      ok: false,
      query: trimmed,
      sources: [],
      error: error instanceof Error && error.message ? error.message : '联网搜索服务不可用',
    };
  }
}

function formatSources(sources: readonly WebSearchSource[]): string {
  return sources.map(source => (
    `[${source.index}] ${source.title}\nURL: ${source.url || '无'}\n摘要: ${source.snippet}${source.summary ? `\nAI摘要: ${source.summary}` : ''}`
  )).join('\n\n');
}

/** Text for the search results card; all searches of one turn share one card. */
export function formatSearchDisplay(
  queries: readonly string[],
  sources: readonly WebSearchSource[],
  summaries: readonly string[],
): string {
  let text = `## 联网搜索结果\n搜索关键词: "${queries.join('" / "')}"\n\n${formatSources(sources)}`;
  if (summaries.length > 0) text += `\n\n## AI 搜索摘要\n${summaries.join('\n\n')}`;
  return text;
}

/** Text the model reads as the web_search tool result. */
export function formatSearchForModel(outcome: WebSearchOutcome): string {
  let text = `搜索关键词: "${outcome.query}"\n\n${formatSources(outcome.sources)}`;
  if (outcome.summary) text += `\n\n## AI 搜索摘要\n${outcome.summary}`;
  return `${text}\n\n请基于以上结果作答，并在引用处标注来源编号（如 [1]、[2]）。`;
}

/**
 * Incremental reasoning text from a streaming delta. Relays name it differently
 * (DeepSeek: reasoning_content; others: reasoning or thinking). '' when absent.
 */
export function extractReasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== 'object') return '';
  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const value = (delta as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}
