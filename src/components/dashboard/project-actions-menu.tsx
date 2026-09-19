'use client';

import { useRef } from 'react';
import { ArrowRight, MoreVertical, Pencil, Share2, Trash2 } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface DashboardProjectActionsMenuProps {
  projectName: string;
  onRename: () => void;
  onExport: () => void;
  onManageShare: (returnFocusTarget: HTMLButtonElement) => void;
  onDelete: () => void;
}

export function DashboardProjectActionsMenu({
  projectName,
  onRename,
  onExport,
  onManageShare,
  onDelete,
}: DashboardProjectActionsMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={`${projectName} 项目操作菜单`}
          onClick={event => event.stopPropagation()}
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        onClick={event => event.stopPropagation()}
      >
        <DropdownMenuItem className="min-h-11" onSelect={onRename}>
          <Pencil aria-hidden="true" />重命名
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={onExport}>
          <ArrowRight aria-hidden="true" />导出 .wujie
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11"
          onSelect={() => {
            if (triggerRef.current) onManageShare(triggerRef.current);
          }}
        >
          <Share2 aria-hidden="true" />管理分享
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={onDelete}>
          <Trash2 aria-hidden="true" />删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
