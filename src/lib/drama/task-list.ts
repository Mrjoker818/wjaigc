import { shotLabel } from './readiness';
import type { DramaProjectV1 } from './types';

export type WorkbenchTaskKind = 'shot' | 'keyframe' | 'voiceover' | 'render' | 'job';

export interface WorkbenchTask {
  id: string;
  kind: WorkbenchTaskKind;
  label: string;
  /** Shot the task works on, so the panel can jump to it. */
  shotId?: string;
  progress?: number;
}

export interface WorkbenchTaskSources {
  runningShotIds: ReadonlySet<string>;
  /** Closing frames are listed as `${shotId}:last`. */
  keyframeShotIds: ReadonlySet<string>;
  voiceoverShotIds: ReadonlySet<string>;
  render: { status: string; progress: number };
  busyLabel: string | null;
}

/** Everything the workbench is waiting on, newest kind of work last, each shot task named the way the grid numbers it. */
export function workbenchTasks(doc: DramaProjectV1, sources: WorkbenchTaskSources): WorkbenchTask[] {
  const tasks: WorkbenchTask[] = [];
  const name = (shotId: string) => shotLabel(doc, shotId) ?? '已删除的镜头';
  for (const shotId of sources.runningShotIds) tasks.push({ id: `shot:${shotId}`, kind: 'shot', shotId, label: `${name(shotId)} · 生成视频` });
  for (const key of sources.keyframeShotIds) {
    const closing = key.endsWith(':last');
    const shotId = closing ? key.slice(0, -':last'.length) : key;
    tasks.push({ id: `keyframe:${key}`, kind: 'keyframe', shotId, label: `${name(shotId)} · ${closing ? '画尾帧' : '画关键帧'}` });
  }
  for (const shotId of sources.voiceoverShotIds) tasks.push({ id: `voice:${shotId}`, kind: 'voiceover', shotId, label: `${name(shotId)} · 录配音` });
  if (sources.render.status === 'rendering') tasks.push({ id: 'render', kind: 'render', label: '渲染成片', progress: sources.render.progress });
  if (sources.busyLabel) tasks.push({ id: 'job', kind: 'job', label: sources.busyLabel });
  return tasks;
}
