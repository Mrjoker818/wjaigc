"use client";

import { Check } from "lucide-react";
import { deriveWorkPlanProgress, type WorkPlan, type WorkPlanStepStatus } from "@/lib/chatgpt-work-mode";

const STATUS_TEXT: Record<WorkPlanStepStatus, string> = {
  done: '已完成',
  running: '正在写',
  pending: '待开始',
  skipped: '未单独展开',
};

/**
 * Work-mode plan shown above a reply. Step states come from the `## 步骤 n` headings the model
 * has written so far, so a step is only marked done when the reply really reached it. A finished
 * reply without any step heading (a failed request, or a model that ignored the format) shows no
 * card rather than a plan that claims progress.
 */
export function WorkPlanCard({ plan, content, finished }: { plan: WorkPlan; content: string; finished: boolean }) {
  const progress = deriveWorkPlanProgress(plan, content, finished);
  if (finished && progress.current === 0) return null;
  const total = plan.steps.length;
  const doneCount = progress.statuses.filter(status => status === 'done').length;
  const waiting = finished && progress.statuses.includes('pending');
  const summary = finished
    ? (doneCount === total ? '已完成' : waiting ? `完成 ${doneCount}/${total} 步 · 待你回复` : `完成 ${doneCount}/${total} 步`)
    : `第 ${progress.current}/${total} 步`;

  return (
    <section
      aria-label={`工作计划：${plan.deliverable}`}
      data-testid="work-plan-card"
      className="mb-3 rounded-xl border border-primary/25 bg-primary/[0.04] px-3 py-2.5 text-xs"
    >
      <header className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          工作计划 <span className="font-normal text-muted-foreground">· {plan.deliverable}</span>
        </h3>
        <span className="shrink-0 tabular-nums text-primary" aria-live="polite">{summary}</span>
      </header>
      <ol className="mt-2">
        {plan.steps.map((step, index) => {
          const status = progress.statuses[index];
          const last = index === total - 1;
          return (
            <li key={step.id} className="relative flex min-w-0 items-start gap-2.5 pb-1.5 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={`absolute left-[7px] top-[18px] bottom-0 w-px ${status === 'done' ? 'bg-primary/60' : 'bg-border'}`}
                />
              )}
              <span
                aria-hidden
                className={`relative z-[1] mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border ${
                  status === 'done'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : status === 'running'
                      ? 'border-primary bg-card'
                      : status === 'skipped'
                        ? 'border-dashed border-muted-foreground/50 bg-card'
                        : 'border-border bg-card'
                }`}
              >
                {status === 'done' && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                {status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" />}
              </span>
              <span className={`min-w-0 flex-1 leading-[18px] [overflow-wrap:anywhere] ${
                status === 'pending' || status === 'skipped' ? 'text-muted-foreground' : 'text-foreground'
              }`}>
                {step.title}
              </span>
              {(status === 'running' || status === 'skipped' || (finished && status === 'pending')) && (
                <span aria-hidden className={`shrink-0 leading-[18px] ${status === 'running' ? 'text-primary' : 'text-muted-foreground'}`}>
                  {finished && status === 'pending' ? '待继续' : STATUS_TEXT[status]}
                </span>
              )}
              <span className="sr-only">{finished && status === 'pending' ? '待继续' : STATUS_TEXT[status]}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
