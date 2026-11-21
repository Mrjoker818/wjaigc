"use client";

import { Check, X } from "lucide-react";
import { deriveSimpleChatPdfSteps, SIMPLE_CHAT_PDF_STEPS, type SimpleChatPdfGenerationStatus } from '@/lib/simple-chat-pdf-output';
import {
  SIMPLE_CHAT_SKILL_SOURCE_TEXT, SKILL_FILE_STEPS, deriveSkillFileSteps, isSimpleChatFileSkill,
  type SimpleChatReplySkill, type SkillFileStepStatus,
} from "@/lib/simple-chat-auto-skill";

const STATUS_TEXT: Record<SkillFileStepStatus, string> = {
  done: '已完成', running: '进行中', pending: '未开始', failed: '文件数据不完整，点「重新生成」再试',
};

/**
 * Which skill answered this reply and how it was chosen. A skill that answers with a file also
 * shows how far the reply got. PDF data readiness and actual PDF rendering are
 * separate steps; only a verified endpoint response completes PDF rendering.
 */
export function SkillTraceCard({ skill, content, finished, pdfGenerationStatus, pdfGenerationError }: {
  skill: SimpleChatReplySkill; content: string; finished: boolean; pdfGenerationStatus?: SimpleChatPdfGenerationStatus; pdfGenerationError?: string;
}) {
  const steps = skill.id === 'pdf-master' ? SIMPLE_CHAT_PDF_STEPS : SKILL_FILE_STEPS;
  const statuses = skill.id === 'pdf-master' ? deriveSimpleChatPdfSteps(content, finished, pdfGenerationStatus)
    : isSimpleChatFileSkill(skill.id) ? deriveSkillFileSteps(content, finished) : null;
  return (
    <section aria-label={`技能：${skill.name}`} data-testid="skill-trace" className="mb-2 text-xs">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground">
        <span className="font-medium text-foreground">技能 · {skill.name}</span>
        <span aria-hidden>·</span>
        <span>{SIMPLE_CHAT_SKILL_SOURCE_TEXT[skill.source]}</span>
      </p>
      {statuses && (
        <ol className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {steps.map((label, index) => {
            const status = statuses[index];
            return (
              <li key={label} className={`inline-flex items-center gap-1 ${
                status === 'failed' ? 'text-destructive' : status === 'pending' ? 'text-muted-foreground/60' : 'text-muted-foreground'
              }`}>
                <span aria-hidden className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                  status === 'done' ? 'border-primary bg-primary text-primary-foreground'
                    : status === 'running' ? 'border-primary'
                      : status === 'failed' ? 'border-destructive' : 'border-border'
                }`}>
                  {status === 'done' && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  {status === 'failed' && <X className="h-2.5 w-2.5" strokeWidth={3} />}
                  {status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" />}
                </span>
                {label}
                <span className="sr-only">：{skill.id === 'pdf-master' && index === 3 && status === 'failed'
                  ? '生成失败，请重试' : STATUS_TEXT[status]}</span>
              </li>
            );
          })}
        </ol>
      )}
      {statuses?.[2] === 'failed' && <p className="mt-1 text-destructive">{skill.id === 'pdf-master'
        ? '未收到有效的 PDF 文件数据，无法下载。可补充需求或点「重新生成」再试。'
        : '文件数据不完整，无法下载。点「重新生成」再试一次。'}</p>}
      {skill.id === 'pdf-master' && statuses?.[3] === 'failed' && (
        <p role="alert" className="mt-1 text-destructive">{pdfGenerationError || 'PDF 生成失败，请重试。'}</p>
      )}
    </section>
  );
}
