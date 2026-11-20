"use client";

import { Check, X } from "lucide-react";
import {
  SIMPLE_CHAT_SKILL_SOURCE_TEXT, SKILL_FILE_STEPS, deriveSkillFileSteps, isSimpleChatFileSkill,
  type SimpleChatReplySkill, type SkillFileStepStatus,
} from "@/lib/simple-chat-auto-skill";

const STATUS_TEXT: Record<SkillFileStepStatus, string> = {
  done: '已完成', running: '进行中', pending: '未开始', failed: '文件数据不完整，点「重新生成」再试',
};

/**
 * Which skill answered this reply and how it was chosen. A skill that answers with a file also
 * shows how far the reply got, read from its ```json block, so "可以下载" is only ticked once the
 * data really parses.
 */
export function SkillTraceCard({ skill, content, finished }: { skill: SimpleChatReplySkill; content: string; finished: boolean }) {
  const statuses = isSimpleChatFileSkill(skill.id) ? deriveSkillFileSteps(content, finished) : null;
  return (
    <section aria-label={`技能：${skill.name}`} data-testid="skill-trace" className="mb-2 text-xs">
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground">
        <span className="font-medium text-foreground">技能 · {skill.name}</span>
        <span aria-hidden>·</span>
        <span>{SIMPLE_CHAT_SKILL_SOURCE_TEXT[skill.source]}</span>
      </p>
      {statuses && (
        <ol className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {SKILL_FILE_STEPS.map((label, index) => {
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
                <span className="sr-only">：{STATUS_TEXT[status]}</span>
              </li>
            );
          })}
        </ol>
      )}
      {statuses?.[2] === 'failed' && <p className="mt-1 text-destructive">文件数据不完整，无法下载。点「重新生成」再试一次。</p>}
    </section>
  );
}
