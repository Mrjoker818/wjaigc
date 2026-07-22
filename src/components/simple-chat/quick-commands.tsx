"use client";

import { useState } from "react";
import { ChevronDown, FileSearch, ImagePlus, MessageSquareText, PenLine, Sparkles, Wand2 } from "lucide-react";

export interface QuickCommand {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  requiresImage?: boolean;
}

export const QUICK_COMMANDS: QuickCommand[] = [
  {
    id: "analyze-competitor",
    label: "深度分析图片",
    icon: "FileSearch",
    requiresImage: true,
    prompt: `请对这张图片进行专业的文案策划深度分析，按以下结构输出报告：

## 一、视觉构成分析
- 画面主体与视觉焦点
- 色彩搭配与情绪调性
- 构图方式与视觉引导

## 二、文案拆解
- 标题/主文案的写法特点（句式、语气、卖点表达）
- 辅助文案的信息层级
- CTA（行动号召）设计

## 三、受众画像推断
- 目标人群特征
- 触发的情感诉求

## 四、传播策略评估
- 适用投放渠道分析
- 优势与不足

## 五、行动建议
- 给出3条可直接复用的文案创作建议`,
  },
  {
    id: "copy-for-image",
    label: "生成配套文案",
    icon: "PenLine",
    requiresImage: true,
    prompt: "请为这张图片生成配套文案：1) 朋友圈文案（轻松口语化，带emoji）2) 小红书文案（种草风格，带话题标签）3) 海报主标题+副标题（精炼有力）",
  },
  {
    id: "img2img",
    label: "以此图生成新图",
    icon: "ImagePlus",
    requiresImage: true,
    prompt: "基于这张图片生成一张类似风格的新图片",
  },
  {
    id: "polish",
    label: "润色文案",
    icon: "Wand2",
    prompt: "请润色以下文案，保持原意但让表达更流畅有力，并给出2个不同风格版本：\n\n",
  },
  {
    id: "slogan",
    label: "生成标语",
    icon: "Sparkles",
    prompt: "请为以下产品/品牌生成5个标语（Slogan）候选，要求简洁有力、易记忆、有传播力：\n\n",
  },
  {
    id: "title-pack",
    label: "标题党生成器",
    icon: "MessageSquareText",
    prompt: "请为以下内容生成10个吸睛标题，覆盖不同风格：悬念式、数字式、痛点式、利益式、对比式：\n\n",
  },
];

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  FileSearch, PenLine, ImagePlus, Wand2, Sparkles, MessageSquareText,
};

interface QuickCommandsProps {
  onSelect: (prompt: string) => void;
  hasImages: boolean;
  disabled?: boolean;
  isMonochrome?: boolean;
  onClose?: () => void;
}

export function QuickCommands({ onSelect, hasImages, disabled }: QuickCommandsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex h-9 items-center gap-1 rounded-lg border border-border bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:opacity-40"
        title="快捷指令"
      >
        <Sparkles size={14} />
        <span className="hidden sm:inline">快捷指令</span>
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
            <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              文案策划快捷指令
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {QUICK_COMMANDS.map(cmd => {
                const Icon = ICON_MAP[cmd.icon] || Sparkles;
                const needsImage = cmd.requiresImage && !hasImages;
                return (
                  <button
                    key={cmd.id}
                    disabled={needsImage}
                    onClick={() => { onSelect(cmd.prompt); setOpen(false); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    title={needsImage ? "需先上传图片" : cmd.label}
                  >
                    <Icon size={15} className="shrink-0 text-primary" />
                    <span>{cmd.label}</span>
                    {cmd.requiresImage && <span className="ml-auto text-[10px] text-muted-foreground">需图片</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
