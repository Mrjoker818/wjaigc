'use client';

import { useEffect, useRef, useState } from 'react';
import { ListTodo, Loader2 } from 'lucide-react';
import { workbenchTasks } from '@/lib/drama/task-list';
import { useDrama } from './drama-context';

/** Top-bar button listing everything still running; shot tasks jump to their shot. Hidden while idle. */
export function DramaTaskPanel() {
  const { doc, runningShotIds, keyframeShotIds, voiceoverShotIds, render, busyLabel, selectShot, setStep } = useDrama();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tasks = workbenchTasks(doc, { runningShotIds, keyframeShotIds, voiceoverShotIds, render, busyLabel });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  useEffect(() => { if (tasks.length === 0) setOpen(false); }, [tasks.length]);

  if (tasks.length === 0) return null;
  return (
    <div ref={root} className="relative">
      {/* A status role inside the button would hide its text from the button's accessible name, so the live region sits beside it. */}
      <span role="status" className="sr-only">{tasks.length} 个任务进行中</span>
      <button type="button" className="drama-btn" aria-expanded={open} aria-controls="drama-task-list" onClick={() => setOpen(value => !value)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span className="font-mono text-xs">{tasks.length} 个任务进行中</span>
      </button>
      {open ? (
        <div id="drama-task-list" className="drama-panel absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] p-2 shadow-2xl">
          <p className="drama-label flex items-center gap-1.5 px-1.5 pb-1.5"><ListTodo className="h-3.5 w-3.5" aria-hidden="true" />进行中的任务 · 可以继续编辑其他镜头</p>
          <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {tasks.map(task => (
              <li key={task.id}>
                {task.shotId ? (
                  <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-sm hover:bg-[var(--drama-graphite)]"
                    onClick={() => { setStep('shots'); selectShot(task.shotId!); setOpen(false); }}>
                    <span className="min-w-0 flex-1 truncate">{task.label}</span>
                    <span className="drama-label shrink-0">查看</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2 px-1.5 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{task.label}</span>
                    {task.progress !== undefined ? <span className="font-mono text-xs text-[var(--drama-muted)]">{task.progress}%</span> : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
