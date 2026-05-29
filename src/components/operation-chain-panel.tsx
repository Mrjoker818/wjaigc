'use client';

import React, { useState, useCallback } from 'react';
import {
  GitBranch, Play, StepForward, RotateCcw, Plus,
  Image as ImageIcon, Scissors, Maximize2, Palette, Square, Eraser,
  Sparkles, Eye, Scan, Pencil, Repeat, Package, Download, FileCode, FileImage,
  LogIn, Link, Type, Layers, ToggleRight, GitMerge, Bot, ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  PipelineChain, PipelineStep, PipelineStepType, PipelineStepStatus,
  NODE_CATEGORIES, NodeItem, getStepTypeColor, getStepStatusColor,
  generateStepId,
} from '@/lib/pipeline-chain';

interface OperationChainPanelProps {
  /** 当前选中的图片的操作链 */
  chain: PipelineChain | null;
  /** 当前选中图片名称 */
  imageName?: string;
  /** 主题风格 */
  themeStyle: 'gold' | 'monochrome';
  /** 添加操作步骤回调（含nodeId用于查找apiAction） */
  onAddStep?: (stepType: PipelineStepType, label: string, nodeId?: string) => void;
  /** 执行操作链回调 */
  onRunChain?: () => void;
  /** 逐步执行回调 */
  onStepChain?: () => void;
  /** 重置操作链回调 */
  onResetChain?: () => void;
}

/** 步骤图标映射 */
function getStepIcon(type: PipelineStepType, size: number = 14) {
  const iconMap: Record<PipelineStepType, React.ReactNode> = {
    load: <ImageIcon size={size} />,
    process: <Layers size={size} />,
    generate: <Sparkles size={size} />,
    condition: <GitBranch size={size} />,
    loop: <Repeat size={size} />,
    agent: <Bot size={size} />,
    subgraph: <Package size={size} />,
    output: <Download size={size} />,
    edit: <Pencil size={size} />,
  };
  return iconMap[type] || <Square size={size} />;
}

/** 步骤状态徽章 */
function StepStatusBadge({ status, progress, loopCount, loopCurrent }: {
  status: PipelineStepStatus;
  progress?: number;
  loopCount?: number;
  loopCurrent?: number;
}) {
  if (status === 'completed') {
    return <span className="text-[#2ea043] text-xs">&#10003;</span>;
  }
  if (status === 'running') {
    return (
      <span className="text-[#d4af37] text-[10px] flex items-center gap-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#d4af37] animate-pulse" />
        执行中...
      </span>
    );
  }
  if (status === 'failed') {
    return <span className="text-[#f85149] text-[10px]">失败</span>;
  }
  if (status === 'cancelled') {
    return <span className="text-[#7d8590] text-[10px]">已取消</span>;
  }
  if (loopCount !== undefined && loopCount > 0) {
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#d29922]/15 text-[#d29922] border border-[#d29922]/30">
        x{loopCount}
      </span>
    );
  }
  return <span className="text-[#7d8590] text-[10px]">等待</span>;
}

/** 添加操作下拉菜单项的图标 */
function getNodeItemIcon(iconName: string, size: number = 14) {
  const iconMap: Record<string, React.ReactNode> = {
    'image': <ImageIcon size={size} />,
    'link': <Link size={size} />,
    'type': <Type size={size} />,
    'scissors': <Scissors size={size} />,
    'maximize-2': <Maximize2 size={size} />,
    'image-plus': <Sparkles size={size} />,
    'palette': <Palette size={size} />,
    'square': <Square size={size} />,
    'eraser': <Eraser size={size} />,
    'scan': <Scan size={size} />,
    'sparkles': <Sparkles size={size} />,
    'pencil': <Pencil size={size} />,
    'eye': <Eye size={size} />,
    'git-branch': <GitBranch size={size} />,
    'repeat': <Repeat size={size} />,
    'git-merge': <GitMerge size={size} />,
    'toggle-right': <ToggleRight size={size} />,
    'package': <Package size={size} />,
    'layers': <Layers size={size} />,
    'download': <Download size={size} />,
    'file-code': <FileCode size={size} />,
    'file-image': <FileImage size={size} />,
    'log-in': <LogIn size={size} />,
    'bot': <Bot size={size} />,
  };
  return iconMap[iconName] || <Square size={size} />;
}

export function OperationChainPanel({
  chain,
  imageName,
  themeStyle,
  onAddStep,
  onRunChain,
  onStepChain,
  onResetChain,
}: OperationChainPanelProps) {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    input: true,
    process: true,
    agent: false,
    logic: false,
    subgraph: false,
    output: false,
  });
  const [searchQuery, setSearchQuery] = useState('');

  const isMono = themeStyle === 'monochrome';
  const textColor = isMono ? 'text-gray-900' : 'text-[#e6edf3]';
  const mutedColor = isMono ? 'text-gray-500' : 'text-[#7d8590]';
  const bgColor = isMono ? 'bg-white' : 'bg-[#161b22]';
  const cardBg = isMono ? 'bg-gray-50' : 'bg-[#1c2333]';
  const cardBgDim = isMono ? 'bg-gray-50/50' : 'bg-[#1c2333]/50';
  const borderColor = isMono ? 'border-gray-200' : 'border-[#30363d]';
  const borderDimColor = isMono ? 'border-gray-100' : 'border-[#21262d]';

  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => ({ ...prev, [catId]: !prev[catId] }));
  };

  const handleAddNode = (item: NodeItem) => {
    onAddStep?.(item.stepType, item.label, item.id);
    setShowAddMenu(false);
  };

  // 搜索过滤
  const filteredCategories = searchQuery
    ? NODE_CATEGORIES.map(cat => ({
        ...cat,
        items: cat.items.filter(item =>
          item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      })).filter(cat => cat.items.length > 0)
    : NODE_CATEGORIES;

  // 没有选中图片时的空态
  if (!chain) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <GitBranch size={32} className={mutedColor + ' mb-3'} />
        <p className={`text-sm font-medium ${mutedColor}`}>未选中图片</p>
        <p className={`text-xs ${mutedColor} mt-1`}>选中画布图片后查看操作链</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* 标题 */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${borderDimColor}/20`}>
        <div className="flex items-center gap-2">
          <GitBranch size={16} className={isMono ? 'text-blue-500' : 'text-[#d4af37]'} />
          <span className={`text-sm font-semibold ${textColor}`}>操作链</span>
        </div>
        <span className={`text-[10px] ${mutedColor}`}>
          {imageName || `图片 #${chain.imageId.slice(-6)}`}
        </span>
      </div>

      {/* 步骤列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{
        scrollbarWidth: 'thin',
        scrollbarColor: isMono ? '#d1d5db transparent' : '#444 transparent',
      }}>
        {chain.steps.map((step, idx) => (
          <StepCard
            key={step.id}
            step={step}
            index={idx + 1}
            isLast={idx === chain.steps.length - 1}
            themeStyle={themeStyle}
          />
        ))}

        {/* 添加操作按钮 */}
        <button
          onClick={() => setShowAddMenu(!showAddMenu)}
          className={`w-full py-2 rounded-lg border border-dashed ${isMono ? 'border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500' : 'border-[#21262d]/40 text-[#7d8590] hover:border-[#d4af37]/40 hover:text-[#d4af37]'} text-xs transition-colors flex items-center justify-center gap-1.5`}
        >
          <Plus size={14} />
          添加操作
        </button>

        {/* 快捷类型标签 */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: '🎨 处理', type: 'process' as PipelineStepType, color: '#8b5cf6' },
            { label: '🔀 条件', type: 'condition' as PipelineStepType, color: '#f59e0b' },
            { label: '🔄 循环', type: 'loop' as PipelineStepType, color: '#d29922' },
            { label: '📦 子图', type: 'subgraph' as PipelineStepType, color: '#06b6d4' },
          ].map(tag => (
            <button
              key={tag.type}
              onClick={() => onAddStep?.(tag.type, tag.label.replace(/^[^\s]+\s/, ''), undefined)}
              className={`px-2 py-0.5 rounded-full text-[10px] cursor-pointer transition-colors ${isMono ? 'hover:opacity-80' : 'hover:opacity-80'}`}
              style={{
                backgroundColor: `${tag.color}15`,
                color: tag.color,
                border: `1px solid ${tag.color}20`,
              }}
            >
              {tag.label}
            </button>
          ))}
        </div>

        {/* 添加操作下拉菜单 */}
        {showAddMenu && (
          <div className={`${cardBg} rounded-lg border ${borderColor} shadow-lg overflow-hidden`}>
            {/* 搜索框 */}
            <div className={`px-3 py-2 border-b ${borderDimColor}/20`}>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索节点..."
                className={`w-full text-xs ${bgColor} ${textColor} rounded px-2 py-1.5 border ${borderColor} focus:outline-none focus:ring-1 ${isMono ? 'focus:ring-blue-400' : 'focus:ring-[#d4af37]/30'}`}
              />
            </div>

            {/* 分类列表 */}
            <div className="max-h-48 overflow-y-auto">
              {filteredCategories.map(cat => (
                <div key={cat.id}>
                  <button
                    onClick={() => toggleCategory(cat.id)}
                    className={`w-full px-3 py-1.5 flex items-center gap-2 text-xs ${mutedColor} hover:${textColor} transition-colors`}
                  >
                    {expandedCategories[cat.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="font-medium">{cat.label}</span>
                    <span className="text-[10px]">{cat.items.length}</span>
                  </button>
                  {expandedCategories[cat.id] && cat.items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleAddNode(item)}
                      className={`w-full px-3 pl-7 py-1.5 flex items-center gap-2 text-xs ${textColor} hover:${isMono ? 'bg-gray-100' : 'bg-[#242d3d]'} transition-colors`}
                    >
                      <span style={{ color: getStepTypeColor(item.stepType) }}>
                        {getNodeItemIcon(item.icon)}
                      </span>
                      <span className="flex-1 text-left">{item.label}</span>
                      <span className={`text-[10px] ${mutedColor}`}>{item.description}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部执行控制 */}
      <div className={`px-4 py-3 border-t ${borderDimColor}/20 space-y-2`}>
        {/* 原图对比 */}
        {chain.originalUrl && chain.currentUrl && chain.originalUrl !== chain.currentUrl && (
          <>
            <div className="flex gap-2">
              <div className={`flex-1 rounded ${cardBg} overflow-hidden`} style={{ height: 48 }}>
                <img src={chain.originalUrl} alt="原图" className="w-full h-full object-cover" />
              </div>
              <div className={`flex-1 rounded ${cardBg} overflow-hidden`} style={{ height: 48 }}>
                <img src={chain.currentUrl} alt="当前" className="w-full h-full object-cover" />
              </div>
            </div>
            <div className={`flex items-center justify-between text-[9px] ${mutedColor}`}>
              <span>原图</span>
              <span>当前</span>
            </div>
          </>
        )}

        {/* 执行按钮 */}
        <div className="flex gap-2">
          <button
            onClick={onRunChain}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1 transition-opacity hover:opacity-90 ${
              isMono
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                : 'bg-[#d4af37] text-black'
            }`}
          >
            <Play size={12} />
            执行
          </button>
          <button
            onClick={onStepChain}
            className={`flex-1 py-1.5 rounded-md ${cardBg} ${textColor} text-xs font-medium hover:opacity-80 transition-opacity flex items-center justify-center gap-1`}
          >
            <StepForward size={12} />
            逐步
          </button>
          <button
            onClick={onResetChain}
            className={`py-1.5 px-3 rounded-md ${cardBg} ${mutedColor} text-xs hover:opacity-80 transition-opacity flex items-center justify-center gap-1`}
          >
            <RotateCcw size={12} />
            重置
          </button>
        </div>
      </div>
    </div>
  );
}

/** 单个步骤卡片 */
function StepCard({
  step,
  index,
  isLast,
  themeStyle,
}: {
  step: PipelineStep;
  index: number;
  isLast: boolean;
  themeStyle: 'gold' | 'monochrome';
}) {
  const isMono = themeStyle === 'monochrome';
  const stepColor = getStepTypeColor(step.type);
  const statusColor = getStepStatusColor(step.status);
  const cardBg = isMono ? 'bg-gray-50' : 'bg-[#1c2333]';
  const cardBgDim = isMono ? 'bg-gray-50/50' : 'bg-[#1c2333]/50';
  const textColor = isMono ? 'text-gray-900' : 'text-[#e6edf3]';
  const mutedColor = isMono ? 'text-gray-500' : 'text-[#7d8590]';

  const isRunning = step.status === 'running';
  const isCompleted = step.status === 'completed';
  const isPending = step.status === 'pending';

  return (
    <div
      className={`${isPending ? cardBgDim : cardBg} rounded-lg p-3 border-l-2 transition-all ${
        isRunning
          ? isMono
            ? 'border-blue-500 ring-1 ring-blue-500/30'
            : 'border-[#d4af37] ring-1 ring-[#d4af37]/30'
          : ''
      }`}
      style={{
        borderLeftColor: isRunning ? undefined : statusColor,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{
            backgroundColor: `${statusColor}20`,
            color: statusColor,
          }}
        >
          {index}
        </span>
        <span style={{ color: stepColor }}>
          {getStepIcon(step.type)}
        </span>
        <span className={`text-xs font-medium ${textColor} flex-1`}>{step.label}</span>
        <StepStatusBadge
          status={step.status}
          progress={step.progress}
          loopCount={step.loopCount}
          loopCurrent={step.loopCurrent}
        />
      </div>

      {/* 描述/参数 */}
      {step.description && (
        <div className={`ml-7 text-[10px] ${mutedColor}`}>{step.description}</div>
      )}

      {/* 执行中进度条 */}
      {isRunning && step.progress !== undefined && (
        <div className="ml-7 mt-1.5">
          <div className={`w-full h-1.5 ${isMono ? 'bg-gray-200' : 'bg-[#242d3d]'} rounded-full overflow-hidden`}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${step.progress}%`,
                backgroundColor: isMono ? '#3b82f6' : '#d4af37',
              }}
            />
          </div>
        </div>
      )}

      {/* 结果缩略图 */}
      {isCompleted && step.resultThumbnailUrl && (
        <div className={`ml-7 mt-1.5 w-16 h-12 rounded ${isMono ? 'bg-gray-100' : 'bg-[#242d3d]'} overflow-hidden`}>
          <img src={step.resultThumbnailUrl} alt={step.label} className="w-full h-full object-cover" />
        </div>
      )}

      {/* 条件分支 */}
      {step.type === 'condition' && step.branches && step.branches.length > 0 && (
        <div className="ml-7 flex gap-2 mt-1">
          {step.branches.map((branch, bIdx) => (
            <span
              key={bIdx}
              className="px-1.5 py-0.5 rounded text-[9px] border"
              style={{
                backgroundColor: branch.isTrue ? '#2ea04315' : '#f8514915',
                color: branch.isTrue ? '#2ea043' : '#f85149',
                borderColor: branch.isTrue ? '#2ea04320' : '#f8514920',
              }}
            >
              {branch.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
