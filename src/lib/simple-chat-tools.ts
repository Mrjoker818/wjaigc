import { SearchClient, Config } from 'coze-coding-dev-sdk';

/**
 * Reusable web-search executor for the simple-chat agent loop.
 *
 * Unlike the old one-shot pre-injection, this is called by the model as a tool
 * (web_search), so the model decides WHEN to search, reads the results, and can
 * search again or answer — a real agent closed loop. Results are returned both
 * as a model-facing string (with numbered citations) and as structured items the
 * UI can render as a source list.
 */

export interface WebSearchItem {
  index: number;
  title: string;
  url: string;
  snippet: string;
  summary?: string;
}

export interface WebSearchResult {
  ok: boolean;
  query: string;
  resultCount: number;
  /** Model-facing text with [n] citations; empty when nothing was found. */
  modelText: string;
  /** Structured items for the UI source list. */
  items: WebSearchItem[];
  /** AI summary when the provider returns one. */
  summary?: string;
  error?: string;
}

export async function runWebSearch(
  query: string,
  customHeaders: Record<string, string> | undefined,
  limit = 5,
): Promise<WebSearchResult> {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    return { ok: false, query: '', resultCount: 0, modelText: '', items: [], error: '搜索关键词为空' };
  }
  try {
    const searchClient = new SearchClient(new Config(), customHeaders);
    const resp = await searchClient.webSearch(trimmed, limit, true);
    const rawItems = resp.web_items || [];
    if (rawItems.length === 0) {
      return { ok: true, query: trimmed, resultCount: 0, modelText: '', items: [], summary: resp.summary };
    }
    const items: WebSearchItem[] = rawItems.slice(0, limit).map((item, i) => ({
      index: i + 1,
      title: (item.title || '').replace(/\n/g, ' ').trim(),
      url: item.url || '',
      snippet: (item.snippet || '').replace(/\n/g, ' ').trim(),
      summary: item.summary ? item.summary.replace(/\n/g, ' ').trim() : undefined,
    }));
    const lines = items.map((it) =>
      `[${it.index}] ${it.title}\nURL: ${it.url || '无'}\n摘要: ${it.snippet}${it.summary ? `\nAI摘要: ${it.summary}` : ''}`,
    );
    let modelText = `搜索关键词: "${trimmed}"\n\n${lines.join('\n\n')}`;
    if (resp.summary) modelText += `\n\n## AI 搜索摘要\n${resp.summary}`;
    modelText += '\n\n请基于以上结果作答，并在引用处标注来源编号（如 [1]、[2]）。';
    return { ok: true, query: trimmed, resultCount: items.length, modelText, items, summary: resp.summary };
  } catch (e: unknown) {
    const message = e instanceof Error && e.message ? e.message : '联网搜索服务不可用';
    return { ok: false, query: trimmed, resultCount: 0, modelText: '', items: [], error: message };
  }
}

/**
 * Extracts incremental reasoning text from a streaming delta, across the field
 * names used by different relays/models (DeepSeek: reasoning_content; others:
 * reasoning / thinking). Returns '' when the delta carries no reasoning.
 */
export function extractReasoningDelta(delta: Record<string, unknown> | null | undefined): string {
  if (!delta || typeof delta !== 'object') return '';
  const candidates = ['reasoning_content', 'reasoning', 'thinking'];
  for (const key of candidates) {
    const value = (delta as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}
