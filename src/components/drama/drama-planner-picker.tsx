'use client';

import { useTaskModelCatalog } from '@/hooks/use-task-model-catalog';
import { useDrama } from './drama-context';

/** Uses the same authorized model catalog as the other tools; never stores credentials in the document. */
export function DramaPlannerPicker() {
  const { doc, update, busyLabel, autopilot } = useDrama();
  const { models, loading, error } = useTaskModelCatalog('chat');
  const selected = doc.planner ? `${doc.planner.providerId}::${doc.planner.modelId}` : '';
  const missing = Boolean(selected && !models.some(model => `${model.providerId}::${model.id}` === selected));
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[var(--drama-line)] px-3 py-2">
      <label className="drama-label shrink-0" htmlFor="drama-planner-model">编剧与分镜模型</label>
      <select id="drama-planner-model" className="drama-input min-w-0 max-w-full flex-1 sm:max-w-md" value={selected}
        disabled={loading || Boolean(busyLabel) || Boolean(autopilot)} onChange={event => {
          const model = models.find(item => `${item.providerId}::${item.id}` === event.target.value);
          update(current => ({ ...current, planner: model ? { providerId: model.providerId, modelId: model.id } : undefined }));
        }}>
        <option value="">{loading ? '正在读取授权模型…' : '使用已授权的默认对话模型'}</option>
        {missing ? <option value={selected}>原模型已不可用，请重新选择</option> : null}
        {models.map(model => <option key={`${model.providerId}::${model.id}`} value={`${model.providerId}::${model.id}`}>{model.displayName || model.name || model.id} · {model.providerName || model.providerId}</option>)}
      </select>
      {error || missing ? <span role="status" className="text-xs text-[var(--drama-red)]">{missing ? '此选择不会自动切换到其他供应商' : '模型目录读取失败，请刷新后重试'}</span> : null}
    </div>
  );
}
