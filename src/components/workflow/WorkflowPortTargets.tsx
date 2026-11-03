'use client';

import type { PointerEvent, ReactElement } from 'react';
import { partitionLegacyPortTargets, type LegacyScreenPort, type LegacyScreenRect } from '@/lib/workflow-renderer/legacy-port-targets';
import type { LegacyPortEndpoint } from '@/lib/workflow-renderer/legacy-mobile-pointer';

interface WorkflowPortTargetsProps {
  ports: readonly LegacyScreenPort[];
  bounds: LegacyScreenRect;
  obstacles: readonly LegacyScreenRect[];
  onPointerDown: (event: PointerEvent<HTMLElement>, endpoint: LegacyPortEndpoint) => void;
  onChoose: (endpoint: LegacyPortEndpoint) => void;
}

/** Screen-space targets stay 44px at every zoom; uncertain regions use the host list. */
export function WorkflowPortTargets({ ports, bounds, obstacles, onPointerDown, onChoose }: WorkflowPortTargetsProps): ReactElement {
  const { direct, fallback } = partitionLegacyPortTargets(ports, bounds, obstacles);
  return <div className="pointer-events-none absolute inset-0" style={{ zIndex: 3 }} data-workflow-port-target-layer data-fallback-port-count={fallback.length}>
    {direct.map(port => <button key={port.key} type="button"
      data-workflow-direct-port-target data-workflow-port-node={port.nodeId} data-workflow-port-key={port.portId} data-workflow-port-direction={port.direction}
      aria-label={`${port.label} ${port.direction === 'out' ? '输出' : '输入'} ${port.type} 端口`}
      title={`${port.label} ${port.type}`}
      className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-transparent bg-transparent focus-visible:border-primary focus-visible:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ left: port.rect.x, top: port.rect.y, width: 44, height: 44, touchAction: 'none' }}
      onPointerDown={event => { event.stopPropagation(); onPointerDown(event, port); }}
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); onChoose(port); }}
    />)}
  </div>;
}
