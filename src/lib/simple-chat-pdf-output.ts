import type { SkillFileStepStatus } from '@/lib/simple-chat-auto-skill';

export type SimpleChatPdfRequest = Record<string, unknown> & {
  type: 'markdown' | 'merge' | 'split' | 'form' | 'watermark' | 'extract';
  title?: string;
};

export type SimpleChatPdfGenerationStatus = 'idle' | 'generating' | 'completed' | 'failed';
export const SIMPLE_CHAT_PDF_STEPS = ['理解需求', '编写内容', '文件数据就绪', '生成 PDF'] as const;

const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const pageNumber = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** Check the operation's inputs, not just JSON syntax. Rendering still happens on download. */
function isPdfRequest(value: unknown): value is SimpleChatPdfRequest {
  if (!record(value) || (value.title !== undefined && typeof value.title !== 'string')) return false;
  switch (value.type) {
    case 'markdown':
      return nonempty(value.content) && (value.theme === undefined || typeof value.theme === 'string');
    case 'merge':
      return Array.isArray(value.pdfUrls) && value.pdfUrls.length >= 2 && value.pdfUrls.every(nonempty);
    case 'split':
      return nonempty(value.pdfUrl) && (value.pageRanges === undefined || (
        Array.isArray(value.pageRanges) && value.pageRanges.length > 0 && value.pageRanges.every(range => (
          record(range) && pageNumber(range.start) && pageNumber(range.end) && range.end >= range.start
        ))
      ));
    case 'form':
      return nonempty(value.pdfUrl) && record(value.fields) && Object.values(value.fields).every(field => typeof field === 'string');
    case 'watermark':
      return nonempty(value.pdfUrl) && nonempty(value.watermarkText);
    case 'extract':
      return nonempty(value.pdfUrl) && (value.pageNumbers === undefined || (
        Array.isArray(value.pageNumbers) && value.pageNumbers.length > 0 && value.pageNumbers.every(pageNumber)
      ));
    default:
      return false;
  }
}

/** A model may put explanatory JSON before the PDF request. Use the same match everywhere. */
export function readSimpleChatPdfRequest(content: string): SimpleChatPdfRequest | null {
  // Only a closing fence on its own line ends the block. Markdown code examples
  // inside a JSON string contain escaped newlines and must remain in the payload.
  for (const match of content.matchAll(/```json\b\s*([\s\S]*?)^[ \t]*```[ \t]*\r?$/gim)) {
    try {
      const value: unknown = JSON.parse(match[1]);
      if (isPdfRequest(value)) return value;
    } catch { /* An incomplete or unrelated block is not a PDF request. */ }
  }
  return null;
}

export function deriveSimpleChatPdfSteps(
  content: string,
  finished: boolean,
  generationStatus: SimpleChatPdfGenerationStatus = 'idle',
): SkillFileStepStatus[] {
  if (readSimpleChatPdfRequest(content)) {
    const rendering: SkillFileStepStatus = generationStatus === 'completed' ? 'done'
      : generationStatus === 'generating' ? 'running' : generationStatus === 'failed' ? 'failed' : 'pending';
    return ['done', 'done', 'done', rendering];
  }
  if (finished) return ['done', content.trim() ? 'done' : 'pending', 'failed', 'pending'];
  if (/```json\s/i.test(content)) return ['done', 'done', 'running', 'pending'];
  return content.trim() ? ['done', 'running', 'pending', 'pending'] : ['running', 'pending', 'pending', 'pending'];
}
