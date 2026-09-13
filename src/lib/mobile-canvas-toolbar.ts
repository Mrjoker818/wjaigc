import type { ReactNode } from 'react';

export interface CanvasToolbarAction {
  id: string;
  label: string;
  group: string;
  icon?: ReactNode;
  hidden?: boolean;
  active?: boolean;
  disabled?: boolean;
  onActivate: () => void;
}

export interface MobileCanvasToolbarSlot {
  id: 'select' | 'pan' | 'upload' | 'zoom-status' | 'all-tools';
  label: string;
}

const MOBILE_PRIMARY_SLOTS: readonly MobileCanvasToolbarSlot[] = [
  { id: 'select', label: '选择' },
  { id: 'pan', label: '平移' },
  { id: 'upload', label: '上传' },
  { id: 'zoom-status', label: '缩放' },
  { id: 'all-tools', label: '全部工具' },
];

export function buildMobileCanvasToolbar(actions: readonly CanvasToolbarAction[]): {
  primary: readonly MobileCanvasToolbarSlot[];
  drawer: CanvasToolbarAction[];
} {
  return {
    primary: MOBILE_PRIMARY_SLOTS,
    drawer: actions.filter(action => !action.hidden),
  };
}
