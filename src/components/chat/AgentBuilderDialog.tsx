'use client';

import { useState, useEffect } from 'react';
import { Bot, X } from 'lucide-react';

export interface AgentRecipe {
  id: string;
  name: string;
  operationType: string;
  promptTemplate: string;
  defaultParams: Record<string, unknown>;
  inputHint?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  desc: string;
  color: string;
  prompt: string;
  tools: string[];
  recipes: AgentRecipe[];
  defaultAspectRatio?: string;
  suggestedNextSteps?: { label: string; action: string; prefilledPrompt?: string }[];
  routingKeywords?: string[];
  skillIds?: string[];
}

interface AgentBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (agent: AgentDefinition) => void;
  editingAgent?: AgentDefinition | null;
  isGold: boolean;
}

export function AgentBuilderDialog({ open, onClose, onSave, editingAgent, isGold }: AgentBuilderDialogProps) {
  const [name, setName] = useState(editingAgent?.name || '');
  const [nameEn, setNameEn] = useState(editingAgent?.nameEn || '');
  const [icon, setIcon] = useState(editingAgent?.icon || '🤖');
  const [desc, setDesc] = useState(editingAgent?.desc || '');
  const [color, setColor] = useState(editingAgent?.color || '#c4956a');
  const [rolePosition, setRolePosition] = useState('');
  const [coreTasks, setCoreTasks] = useState('');
  const [aestheticStandards, setAestheticStandards] = useState('');
  const [outputSpec, setOutputSpec] = useState('');

  useEffect(() => {
    if (editingAgent) {
      setName(editingAgent.name);
      setNameEn(editingAgent.nameEn);
      setIcon(editingAgent.icon);
      setDesc(editingAgent.desc);
      setColor(editingAgent.color);
      // Parse the prompt back into sections
      const prompt = editingAgent.prompt;
      const roleMatch = prompt.match(/你是一位(.+?)。\s*专为/);
      if (roleMatch) setRolePosition(roleMatch[1]);
      const coreMatch = prompt.match(/核心任务[：:]\n([\s\S]*?)\n\n审美/);
      if (coreMatch) setCoreTasks(coreMatch[1].trim());
      const aestheticMatch = prompt.match(/审美与技术标准[：:]\n([\s\S]*?)\n\n输出规范/);
      if (aestheticMatch) setAestheticStandards(aestheticMatch[1].trim());
      const outputMatch = prompt.match(/输出规范[：:]\n([\s\S]*?)$/);
      if (outputMatch) setOutputSpec(outputMatch[1].trim());
    } else {
      setName(''); setNameEn(''); setIcon('🤖'); setDesc(''); setColor('#c4956a');
      setRolePosition(''); setCoreTasks(''); setAestheticStandards(''); setOutputSpec('');
    }
  }, [editingAgent, open]);

  if (!open) return null;

  const handleSave = () => {
    if (!name.trim() || !nameEn.trim()) return;
    const prompt = `你是一位${rolePosition || '专业的品牌设计顾问'}。${desc ? '专为高端品牌提供专业设计方案。' : ''}

核心任务：
${coreTasks || '1. 根据用户需求提供专业设计方案\n2. 输出结构化的设计指导\n3. 提供 AI 渲染提示词'}

审美与技术标准：
${aestheticStandards || '- 追求高品质、专业级的视觉效果\n- 注重细节与质感表现\n- 遵循品牌调性与行业规范'}

输出规范：
${outputSpec || '1. 设计理念（200字内）\n2. 详细方案描述\n3. 材质与色彩方案\n4. AI 渲染提示词：必须同时输出中文和英文两个版本，格式如下：\n【中文提示词】用中文描述画面的主体、材质、光照、色彩、风格等，100-200字\n【英文提示词】English prompt describing the subject, materials, lighting, colors, style, 100-200 words'}`;

    onSave({
      id: editingAgent?.id || `custom-${Date.now()}`,
      name: name.trim(),
      nameEn: nameEn.trim(),
      icon,
      desc: desc.trim() || name.trim(),
      color,
      prompt,
      tools: ['generate_image', 'edit_image', 'analyze_image'],
      recipes: [],
    });
    onClose();
  };

  const EMOJI_OPTIONS = ['🤖', '🎯', '💡', '🔮', '🌟', '🎭', '🎪', '💎', '🏆', '⚡', '🔥', '🎨', '📐', '🔧', '🧪', '🌍'];
  const COLOR_OPTIONS = ['#c4956a', '#5b8fb9', '#d4af37', '#e85d75', '#6c5ce7', '#00b894', '#e17055', '#0984e3', '#fdcb6e', '#a29bfe'];

  const inputClass = `w-full h-9 px-3 text-sm rounded-md border transition-colors ${
    isGold
      ? 'bg-white/5 border-white/[0.04] text-text-bright placeholder:text-gold-muted/50 focus:border-gold/50'
      : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400 focus:border-gray-400'
  } outline-none`;

  const labelClass = `text-xs font-medium ${isGold ? 'text-muted-foreground' : 'text-gray-500'}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className={`relative w-[680px] max-h-[85vh] rounded-xl shadow-2xl overflow-hidden flex flex-col ${
          isGold ? 'bg-[#1a1a1a] border border-white/[0.04]' : 'bg-white border border-gray-200'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${isGold ? 'border-white/[0.04]' : 'border-gray-100'}`}>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-gold to-gold-light flex items-center justify-center">
              <Bot size={12} className="text-black" />
            </div>
            <span className={`text-sm font-semibold ${isGold ? 'text-white' : 'text-gray-900'}`}>
              {editingAgent ? '编辑智能体' : '新建智能体'}
            </span>
          </div>
          <button aria-label="关闭" onClick={onClose} className={`p-1 min-h-[44px] min-w-[44px] rounded-md transition-colors ${isGold ? 'hover:bg-white/[0.04] text-gold-muted' : 'hover:bg-gray-100 text-gray-400'}`}>
            <X size={16} />
          </button>
        </div>

        {/* Body - 横向两栏布局 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {/* 左栏：基础信息 */}
            {/* Icon + Name row */}
            <div className="flex gap-2">
              <div className="shrink-0">
                <label className={labelClass}>图标</label>
                <div className="mt-0.5 relative group">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg border cursor-pointer transition-colors ${
                    isGold ? 'bg-white/[0.04] border-white/[0.04] hover:border-white/[0.10]' : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                  }`}>
                    {icon}
                  </div>
                  <div className="absolute top-full left-0 mt-1 p-1.5 grid grid-cols-8 gap-0.5 rounded-lg shadow-xl z-50 hidden group-hover:grid bg-[#1a1a1a] border border-white/[0.04]">
                    {EMOJI_OPTIONS.map(e => (
                      <button key={e} onClick={() => setIcon(e)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/[0.1] text-sm">{e}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                <div>
                  <label className={labelClass}>名称</label>
                  <input className={`${inputClass} mt-0.5`} value={name} onChange={e => setName(e.target.value)} placeholder="如：酒类包装" />
                </div>
                <div>
                  <label className={labelClass}>英文名</label>
                  <input className={`${inputClass} mt-0.5`} value={nameEn} onChange={e => setNameEn(e.target.value)} placeholder="如：Liquor Packaging" />
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>描述</label>
              <input className={`${inputClass} mt-0.5`} value={desc} onChange={e => setDesc(e.target.value)} placeholder="一句话描述智能体能力" />
            </div>

            {/* Color */}
            <div>
              <label className={labelClass}>主题色</label>
              <div className="flex items-center gap-1 mt-0.5">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${color === c ? 'scale-125 border-white' : 'border-transparent hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                />
              </div>
            </div>

            {/* Role Position */}
            <div className="col-span-2">
              <label className={labelClass}>角色定位</label>
              <input
                className={`${inputClass} mt-0.5`}
                value={rolePosition}
                onChange={e => setRolePosition(e.target.value)}
                placeholder="如：顶级的酒类包装设计师与 3D 视觉艺术家"
              />
            </div>

            {/* Core Tasks */}
            <div>
              <label className={labelClass}>核心任务</label>
              <textarea
                className={`${inputClass} h-28 mt-0.5 py-1 resize-none`}
                value={coreTasks}
                onChange={e => setCoreTasks(e.target.value)}
                placeholder={"1. 任务一\n2. 任务二\n3. 任务三\n4. 任务四"}
              />
            </div>

            {/* Aesthetic Standards */}
            <div>
              <label className={labelClass}>审美与技术标准</label>
              <textarea
                className={`${inputClass} h-28 mt-0.5 py-1 resize-none`}
                value={aestheticStandards}
                onChange={e => setAestheticStandards(e.target.value)}
                placeholder={"- 标准1\n- 标准2\n- 标准3\n- 标准4"}
              />
            </div>

            {/* Output Spec */}
            <div className="col-span-2">
              <label className={labelClass}>输出规范</label>
              <textarea
                className={`${inputClass} h-20 mt-0.5 py-1 resize-none`}
                value={outputSpec}
                onChange={e => setOutputSpec(e.target.value)}
                placeholder={"1. 输出项1\n2. 输出项2\n3. 输出项3"}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`flex items-center gap-2 px-4 py-3 border-t ${isGold ? 'border-white/[0.04]' : 'border-gray-100'}`}>
          <button
            onClick={onClose}
            className={`flex-1 h-8 text-xs rounded-lg transition-colors ${
              isGold ? 'bg-white/[0.04] text-muted-foreground hover:bg-white/[0.06]' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !nameEn.trim()}
            className={`flex-1 h-8 text-xs rounded-lg ${isGold ? 'bg-gradient-to-r from-gold to-gold-light text-black' : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'} font-medium transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {editingAgent ? '保存修改' : '创建智能体'}
          </button>
        </div>
      </div>
    </div>
  );
}
