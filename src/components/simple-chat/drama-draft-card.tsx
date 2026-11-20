import { ArrowRight, Clapperboard } from 'lucide-react';
import { platformHref } from '@/lib/platform-routes';
import type { SimpleChatDramaDraft } from '@/lib/simple-chat-drama-draft';

/** A short-drama script the model wrote in this reply; opens it in the video workbench. */
export function DramaDraftCard({ draft }: { draft: SimpleChatDramaDraft }) {
  return (
    <div className="mt-3 min-w-0 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3" data-testid="drama-draft-card">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <Clapperboard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        短剧剧本已保存在短剧工作台
      </div>
      <p className="mt-1.5 text-sm font-semibold [overflow-wrap:anywhere]">《{draft.title}》</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{draft.summary}</p>
      <a
        href={platformHref('video', { projectId: draft.projectId, dramaId: draft.dramaId })}
        className="mt-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-sm font-medium text-black hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
      >
        在短剧工作台打开
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  );
}
