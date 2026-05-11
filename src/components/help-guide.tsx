'use client';

import React, { useState } from 'react';
import { APP_VERSION_LABEL } from '@/config/app-meta';
import {
  X, MousePointer, Hand, ZoomIn,
  Image as ImageIcon, Sparkles, MessageSquare, Layers,
  Download, ChevronRight, Keyboard,
  Pen, Eraser, Crop, Expand, Wand2, Settings,
  Move, BoxSelect,
  Bot, Lightbulb, BookOpen, Info, Zap,
  GitMerge, Shapes, Palette, Users, Wrench
} from 'lucide-react';

interface HelpGuideProps {
  isOpen: boolean;
  onClose: () => void;
  themeStyle?: 'gold' | 'monochrome';
}

type SectionId = 'canvas' | 'generate' | 'chat' | 'psd-editor' | 'omp' | 'fusion' | 'shortcuts' | 'tips' | 'changelog';

interface Section {
  id: SectionId;
  title: string;
  titleEn: string;
  icon: React.ReactNode;
}

const SECTIONS: Section[] = [
  { id: 'canvas', title: '无限画布', titleEn: 'Infinite Canvas', icon: <Move size={16} /> },
  { id: 'generate', title: '图像生成', titleEn: 'Image Generation', icon: <Sparkles size={16} /> },
  { id: 'chat', title: '智能对话', titleEn: 'AI Chat', icon: <MessageSquare size={16} /> },
  { id: 'omp', title: 'Oh My Prompt', titleEn: 'Prompt Manager', icon: <Sparkles size={16} /> },
  { id: 'fusion', title: '参考融合', titleEn: 'Reference Fusion', icon: <GitMerge size={16} /> },
  { id: 'psd-editor', title: 'PSD 图层编辑器', titleEn: 'PSD Layer Editor', icon: <Layers size={16} /> },
  { id: 'shortcuts', title: '快捷键', titleEn: 'Shortcuts', icon: <Keyboard size={16} /> },
  { id: 'tips', title: '使用技巧', titleEn: 'Tips', icon: <Lightbulb size={16} /> },
  { id: 'changelog', title: '更新日志', titleEn: 'Changelog', icon: <BookOpen size={16} /> },
];

// ─── Sub-components ──────────────────────────────────────────────

function ShortcutBadge({ keys, themeStyle }: { keys: string; themeStyle: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${
      themeStyle === 'monochrome'
        ? 'bg-gray-100 text-gray-700 border border-gray-300'
        : 'bg-[#1a1a1a] text-[#d4af37] border border-[#d4af37]/30'
    }`}>
      {keys}
    </span>
  );
}

function FeatureCard({
  icon, title, description, themeStyle
}: {
  icon: React.ReactNode; title: string; titleEn?: string; description: string; themeStyle: string;
}) {
  return (
    <div className={`rounded-xl p-4 border transition-all ${
      themeStyle === 'monochrome'
        ? 'bg-white border-gray-200 hover:border-yellow-300 hover:shadow-md'
        : 'bg-[#1a1a1a] border-[#2a2a2a] hover:border-[#d4af37]/40'
    }`}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          themeStyle === 'monochrome'
            ? 'bg-yellow-100 text-yellow-600'
            : 'bg-[#d4af37]/15 text-[#d4af37]'
        }`}>
          {icon}
        </div>
        <div>
          <h4 className={`text-sm font-semibold ${
            themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
          }`}>{title}</h4>
        </div>
      </div>
      <p className={`text-xs leading-relaxed ${
        themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'
      }`}>{description}</p>
    </div>
  );
}

function SectionTitle({ children, themeStyle }: { children: React.ReactNode; themeStyle: string }) {
  return (
    <h3 className={`text-base font-bold mb-4 flex items-center gap-2 ${
      themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
    }`}>
      {children}
    </h3>
  );
}

function SubSection({ title, themeStyle, children }: { title: string; themeStyle: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h4 className={`text-sm font-semibold mb-2 flex items-center gap-1.5 ${
        themeStyle === 'monochrome' ? 'text-gray-800' : 'text-[#e0e0e0]'
      }`}>
        <ChevronRight size={14} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        {title}
      </h4>
      {children}
    </div>
  );
}

function ShortcutRow({ shortcut, description, themeStyle }: { shortcut: string; description: string; themeStyle: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <span className={`text-xs ${
        themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ccc]'
      }`}>{description}</span>
      <ShortcutBadge keys={shortcut} themeStyle={themeStyle} />
    </div>
  );
}

// ─── Section Renderers ───────────────────────────────────────────

function CanvasSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Move size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        无限画布
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <FeatureCard icon={<MousePointer size={16} />} title="选择图片" titleEn="Select" description="左键单击选择图片，Ctrl+左键多选，拖拽框选区域内的图片" themeStyle={themeStyle} />
        <FeatureCard icon={<Hand size={16} />} title="平移画布" titleEn="Pan" description="空白区域长按拖动平移画布，或按住空格键拖动" themeStyle={themeStyle} />
        <FeatureCard icon={<ZoomIn size={16} />} title="缩放视图" titleEn="Zoom" description="鼠标滚轮缩放画布，支持触摸板双指缩放" themeStyle={themeStyle} />
        <FeatureCard icon={<BoxSelect size={16} />} title="框选多图" titleEn="Marquee" description="在空白区域拖拽创建选区，松开后选区内的图片被选中" themeStyle={themeStyle} />
      </div>

      <SubSection title="画布左上角折叠工具栏" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <p className={`text-xs mb-3 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>
            画布左上角的折叠工具栏整合了所有功能按钮，鼠标悬停自动展开，移开自动收起。
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: <Sparkles size={14} />, label: '灵感提示词库', desc: '提示词管理面板' },
              { icon: <GitMerge size={14} />, label: '参考融合', desc: 'Ctrl+点击融图' },
              { icon: <Settings size={14} />, label: '设置', desc: '生成参数面板' },
              { icon: <Palette size={14} />, label: 'UI 主题', desc: '黑白/彩色切换' },
              { icon: <Users size={14} />, label: '用户管理', desc: '多用户与后台模型' },
              { icon: <Wrench size={14} />, label: '使用说明', desc: '本帮助指南' },
            ].map((tool) => (
              <div key={tool.label} className="flex flex-col items-center gap-1">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  themeStyle === 'monochrome'
                    ? 'bg-white text-gray-600 border border-gray-200'
                    : 'bg-[#1a1a1a] text-[#d4af37] border border-[#2a2a2a]'
                }`}>
                  {tool.icon}
                </div>
                <span className={`text-xs font-medium ${
                  themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ddd]'
                }`}>{tool.label}</span>
                <span className={`text-xs text-center ${
                  themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#666]'
                }`}>{tool.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </SubSection>

      <SubSection title="图片操作工具栏" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: <ZoomIn size={14} />, label: '放大', desc: '高分辨率放大' },
              { icon: <Eraser size={14} />, label: '移除背景', desc: '智能去背景' },
              { icon: <Shapes size={14} />, label: '矢量化', desc: '转为SVG矢量' },
              { icon: <Pen size={14} />, label: '擦除', desc: '画笔擦除区域' },
              { icon: <Wand2 size={14} />, label: '蒙版', desc: '蒙版+提示词生成' },
              { icon: <Expand size={14} />, label: '扩展', desc: '智能扩展画面' },
              { icon: <Crop size={14} />, label: '裁切', desc: '自定义比例裁切' },
              { icon: <Download size={14} />, label: '下载', desc: 'PNG/SVG/PSD' },
            ].map((tool) => (
              <div key={tool.label} className="flex flex-col items-center gap-1">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  themeStyle === 'monochrome'
                    ? 'bg-white text-gray-600 border border-gray-200'
                    : 'bg-[#1a1a1a] text-[#d4af37] border border-[#2a2a2a]'
                }`}>
                  {tool.icon}
                </div>
                <span className={`text-xs font-medium ${
                  themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ddd]'
                }`}>{tool.label}</span>
                <span className={`text-xs text-center ${
                  themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#666]'
                }`}>{tool.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </SubSection>

      <SubSection title="编辑模式" themeStyle={themeStyle}>
        <div className="space-y-2">
          {[
            { mode: '擦除模式', desc: '调整画笔大小后在图片上涂抹擦除区域，点击"确认擦除"执行', icon: <Eraser size={14} /> },
            { mode: '蒙版模式', desc: '用画笔标记需要修改的区域，输入提示词后点击生成', icon: <Wand2 size={14} /> },
            { mode: '扩展模式', desc: '选择扩展比例预设（1:1/16:9等），确认后智能扩展画面', icon: <Expand size={14} /> },
            { mode: '裁切模式', desc: '自由裁切或选择预设比例（1:1/4:3/16:9），确认裁切', icon: <Crop size={14} /> },
          ].map((item) => (
            <div key={item.mode} className={`flex items-start gap-3 p-3 rounded-lg ${
              themeStyle === 'monochrome' ? 'bg-gray-50' : 'bg-[#111]'
            }`}>
              <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${
                themeStyle === 'monochrome' ? 'text-yellow-600 bg-yellow-100' : 'text-[#d4af37] bg-[#d4af37]/15'
              }`}>{item.icon}</div>
              <div>
                <span className={`text-xs font-semibold ${
                  themeStyle === 'monochrome' ? 'text-gray-800' : 'text-[#e0e0e0]'
                }`}>{item.mode}</span>
                <p className={`text-xs mt-0.5 ${
                  themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
                }`}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SubSection>

      <SubSection title="下载格式" themeStyle={themeStyle}>
        <div className="grid grid-cols-3 gap-2">
          {[
            { fmt: 'PNG', desc: '位图导出', modes: '标准位图', color: 'blue' },
            { fmt: 'SVG', desc: '矢量导出', modes: '快速/专业/工作室', color: 'green' },
            { fmt: 'PSD', desc: '分层导出', modes: '基础/专业/工作室', color: 'purple' },
          ].map((item) => (
            <div key={item.fmt} className={`text-center p-3 rounded-lg border ${
              themeStyle === 'monochrome'
                ? 'bg-white border-gray-200'
                : 'bg-[#1a1a1a] border-[#2a2a2a]'
            }`}>
              <div className={`text-lg font-bold ${
                item.fmt === 'PNG' ? (themeStyle === 'monochrome' ? 'text-blue-600' : 'text-blue-400')
                : item.fmt === 'SVG' ? (themeStyle === 'monochrome' ? 'text-green-600' : 'text-green-400')
                : (themeStyle === 'monochrome' ? 'text-purple-600' : 'text-purple-400')
              }`}>{item.fmt}</div>
              <div className={`text-xs ${
                themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
              }`}>{item.desc}</div>
              <div className={`text-xs mt-0.5 ${
                themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#666]'
              }`}>{item.modes}</div>
            </div>
          ))}
        </div>
      </SubSection>

      <SubSection title="图片来源标签" themeStyle={themeStyle}>
        <div className={`rounded-lg p-3 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <p className={`text-xs mb-2 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>
            画布中每张图片左上角会显示来源标签，方便区分图片来源：
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: '生成', color: 'green', desc: 'AI 生成的图片' },
              { label: '上传', color: 'blue', desc: '用户上传的图片' },
              { label: '编辑', color: 'orange', desc: '编辑修改过的图片' },
              { label: '矢量化', color: 'cyan', desc: 'SVG 矢量化后的图片' },
            ].map((tag) => (
              <span key={tag.label} className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                tag.color === 'green' ? (themeStyle === 'monochrome' ? 'bg-green-100 text-green-700' : 'bg-green-500/15 text-green-400')
                : tag.color === 'blue' ? (themeStyle === 'monochrome' ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/15 text-blue-400')
                : tag.color === 'orange' ? (themeStyle === 'monochrome' ? 'bg-orange-100 text-orange-700' : 'bg-orange-500/15 text-orange-400')
                : (themeStyle === 'monochrome' ? 'bg-cyan-100 text-cyan-700' : 'bg-cyan-500/15 text-cyan-400')
              }`}>
                {tag.label} - {tag.desc}
              </span>
            ))}
          </div>
        </div>
      </SubSection>
    </div>
  );
}

function GenerateSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Sparkles size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        图像生成
      </SectionTitle>

      <SubSection title="生成流程" themeStyle={themeStyle}>
        <div className="space-y-0">
          {[
            { step: '1', title: '输入创意描述', desc: '在文本框中输入你想要的图像描述' },
            { step: '2', title: '选择模型与参数', desc: '选择生图模型、画面比例、质量等参数' },
            { step: '3', title: '点击生成', desc: '等待AI生成图像，支持多张同时生成' },
            { step: '4', title: '添加至画布', desc: '生成完成后图片自动添加到画布中' },
          ].map((item, i) => (
            <div key={item.step} className="flex items-start gap-3 relative">
              {/* Step line */}
              {i < 3 && (
                <div className={`absolute left-[15px] top-[32px] w-px h-[calc(100%-16px)] ${
                  themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-[#2a2a2a]'
                }`} />
              )}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold z-10 ${
                themeStyle === 'monochrome'
                  ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                  : 'bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40'
              }`}>
                {item.step}
              </div>
              <div className="pb-4">
                <span className={`text-xs font-semibold ${
                  themeStyle === 'monochrome' ? 'text-gray-800' : 'text-[#e0e0e0]'
                }`}>{item.title}</span>
                <p className={`text-xs mt-0.5 ${
                  themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
                }`}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SubSection>

      <SubSection title="支持模型" themeStyle={themeStyle}>
        <div className="grid grid-cols-2 gap-2">
          {[
            { name: '达利3', provider: '开放人工智能', type: '创意' },
            { name: '中途绘图', provider: '中途绘图', type: '艺术' },
            { name: '稳定扩散', provider: '稳定人工智能', type: '写实' },
            { name: 'Flux 专业版', provider: '黑森林实验室', type: '精细' },
          ].map((model) => (
            <div key={model.name} className={`p-3 rounded-lg border ${
              themeStyle === 'monochrome'
                ? 'bg-white border-gray-200'
                : 'bg-[#1a1a1a] border-[#2a2a2a]'
            }`}>
              <div className={`text-xs font-semibold ${
                themeStyle === 'monochrome' ? 'text-gray-800' : 'text-white'
              }`}>{model.name}</div>
              <div className={`text-xs mt-0.5 flex items-center justify-between ${
                themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#666]'
              }`}>
                <span>{model.provider}</span>
                <span className={`px-1.5 py-0.5 rounded text-xs ${
                  themeStyle === 'monochrome'
                    ? 'bg-yellow-50 text-yellow-600'
                    : 'bg-[#d4af37]/10 text-[#d4af37]'
                }`}>{model.type}</span>
              </div>
            </div>
          ))}
        </div>
      </SubSection>

      <SubSection title="高级设置" themeStyle={themeStyle}>
        <div className="space-y-2">
          {[
            { label: '画面比例', desc: '1:1 / 16:9 / 9:16 / 4:3 / 3:4 等，根据模型自动适配' },
            { label: '生图质量', desc: '标准 / 高清 / 超高清，部分模型支持' },
            { label: '生成数量', desc: 'x1/x2/x3/x4 多张同时生成，根据模型能力自动调整' },
            { label: '产品品类', desc: '通用 / 服装 / 鞋类 / 美妆等，优化品类效果' },
          ].map((setting) => (
            <div key={setting.label} className={`flex items-start gap-2 p-2.5 rounded-lg ${
              themeStyle === 'monochrome' ? 'bg-gray-50' : 'bg-[#111]'
            }`}>
              <Zap size={12} className={`mt-0.5 flex-shrink-0 ${
                themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'
              }`} />
              <div>
                <span className={`text-xs font-medium ${
                  themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ccc]'
                }`}>{setting.label}</span>
                <span className={`text-xs ml-1 ${
                  themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
                }`}>{setting.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </SubSection>

      <SubSection title="参考图片（增强）" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <p className={`text-xs mb-3 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>
            上传参考图后，支持4种参考类型与强度调节，精确控制生成效果：
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { type: '风格参考', desc: '参照参考图的风格、色调、艺术风格生成', tag: '风格' },
              { type: '构图参考', desc: '参照参考图的构图、布局、空间结构生成', tag: '构图' },
              { type: '角色参考', desc: '参照参考图中的角色形象、人物特征生成', tag: '角色' },
              { type: 'IP 适配器', desc: '高度还原参考图中的核心视觉元素', tag: '图像适配' },
            ].map((ref) => (
              <div key={ref.type} className={`p-3 rounded-lg border ${
                themeStyle === 'monochrome'
                  ? 'bg-white border-gray-200'
                  : 'bg-[#1a1a1a] border-[#2a2a2a]'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold ${
                    themeStyle === 'monochrome' ? 'text-gray-800' : 'text-white'
                  }`}>{ref.type}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                    themeStyle === 'monochrome'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-[#d4af37]/15 text-[#d4af37]'
                  }`}>{ref.tag}</span>
                </div>
                <p className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'}`}>{ref.desc}</p>
              </div>
            ))}
          </div>
          <p className={`text-xs mt-2 ${themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#666]'}`}>
            每张参考图可独立设置强度（0-100%），强度越高参考效果越明显
          </p>
        </div>
      </SubSection>
    </div>
  );
}

function ChatSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <MessageSquare size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        智能对话
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <FeatureCard icon={<Bot size={16} />} title="人工智能模型" titleEn="AI Models" description="支持复杂推理、快速对话与轻量分析等联网思考模式" themeStyle={themeStyle} />
        <FeatureCard icon={<ImageIcon size={16} />} title="图像理解" titleEn="Image Understanding" description="上传图片让人工智能分析内容、提取关键词、优化提示词" themeStyle={themeStyle} />
        <FeatureCard icon={<Wand2 size={16} />} title="提示词优化" titleEn="Prompt Master" description="增强/扩展/精简三种优化模式，结果一键发送到生成面板" themeStyle={themeStyle} />
        <FeatureCard icon={<Settings size={16} />} title="智能体" titleEn="Agents" description="内置酒类包装、品牌VI等专业智能体，精准行业方案" themeStyle={themeStyle} />
      </div>

      <SubSection title="提示词优化模式" themeStyle={themeStyle}>
        <div className="space-y-2">
          {[
            { mode: '增强模式', desc: '保留原意，补充细节描述和构图要素，提升画面表现力', tag: '增强' },
            { mode: '扩展模式', desc: '在原意基础上发散扩展，增加更多创意元素和场景描述', tag: '扩展' },
            { mode: '精简模式', desc: '提炼核心要素，去除冗余，生成精准的高质量提示词', tag: '精简' },
          ].map((item) => (
            <div key={item.mode} className={`flex items-center justify-between p-3 rounded-lg border ${
              themeStyle === 'monochrome'
                ? 'bg-white border-gray-200'
                : 'bg-[#1a1a1a] border-[#2a2a2a]'
            }`}>
              <div>
                <span className={`text-xs font-semibold ${
                  themeStyle === 'monochrome' ? 'text-gray-800' : 'text-[#e0e0e0]'
                }`}>{item.mode}</span>
                <p className={`text-xs mt-0.5 ${
                  themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
                }`}>{item.desc}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                themeStyle === 'monochrome'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-[#d4af37]/15 text-[#d4af37]'
              }`}>{item.tag}</span>
            </div>
          ))}
        </div>
      </SubSection>
    </div>
  );
}

function OmpSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Sparkles size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        灵感提示词库
      </SectionTitle>

      <SubSection title="功能概览" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <p className={`text-xs mb-3 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>
            灵感提示词库是内置的提示词管理工具，通过画布左上角折叠工具栏中的按钮打开。提供四大核心功能：
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { title: '一键插入', desc: '从预设分类中选择提示词，一键插入到图像生成的创意描述', icon: '📋', tag: '插入' },
              { title: '分类管理', desc: '创建、编辑、删除自定义提示词分类，管理你的提示词库', icon: '📁', tag: '管理' },
              { title: '资源库', desc: '内置人物肖像、风景自然、建筑空间、艺术风格四大分类精选提示词', icon: '📚', tag: '资源' },
              { title: '图片识词', desc: '人工智能视觉分析图片内容，自动生成中英双语提示词描述', icon: '👁', tag: '识图' },
            ].map((item) => (
              <div key={item.title} className={`p-3 rounded-lg border ${
                themeStyle === 'monochrome'
                  ? 'bg-white border-gray-200'
                  : 'bg-[#1a1a1a] border-[#2a2a2a]'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{item.icon}</span>
                  <span className={`text-xs font-semibold ${
                    themeStyle === 'monochrome' ? 'text-gray-800' : 'text-[#e0e0e0]'
                  }`}>{item.title}</span>
                  <span className={`ml-auto px-1.5 py-0.5 rounded text-xs font-medium ${
                    themeStyle === 'monochrome'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-[#d4af37]/15 text-[#d4af37]'
                  }`}>{item.tag}</span>
                </div>
                <p className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'}`}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </SubSection>

      <SubSection title="打开方式" themeStyle={themeStyle}>
        <div className={`rounded-lg p-3 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
              themeStyle === 'monochrome'
                ? 'bg-yellow-100 text-yellow-600'
                : 'bg-[#d4af37]/15 text-[#d4af37]'
            }`}>
              <Sparkles size={18} />
            </div>
            <div>
              <p className={`text-xs font-medium mb-1 ${themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ccc]'}`}>
                画布左上角折叠工具栏 → 灵感提示词库按钮
              </p>
              <p className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'}`}>
                鼠标悬停工具栏展开按钮 → 点击星光图标 → 弹出提示词库面板
              </p>
            </div>
          </div>
        </div>
      </SubSection>

      <SubSection title="图片识词工作流" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <div className="space-y-2">
            {[
              { step: 1, text: '在画布左上角工具栏开启灵感提示词库功能' },
              { step: 2, text: '将鼠标悬停在画布中的任意图片上' },
              { step: 3, text: '点击图片上出现的 ✨ 按钮触发 AI 视觉分析' },
              { step: 4, text: 'AI 自动分析图片内容，生成中英双语提示词' },
              { step: 5, text: '分析结果自动插入到图像生成的创意描述中' },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  themeStyle === 'monochrome'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-[#d4af37]/15 text-[#d4af37]'
                }`}>{item.step}</div>
                <span className={`text-xs pt-0.5 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>{item.text}</span>
              </div>
            ))}
          </div>
          <p className={`text-xs mt-3 ${themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#666]'}`}>
            模型自动同步：使用当前选择的模型对应的后台配置，无需额外输入
          </p>
        </div>
      </SubSection>
    </div>
  );
}

function FusionSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <GitMerge size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        参考融合
      </SectionTitle>

      <SubSection title="功能概览" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <p className={`text-xs mb-3 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>
            参考融合允许你从画布中选择多张图片作为参考，为每张图指定关键词，然后融合生成一张全新的创意图片。
            选中的图片会以 SVG 连接线连接到输出框，直观展示融合关系。
          </p>
          <div className={`rounded-lg p-3 border ${
            themeStyle === 'monochrome' ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#2a2a2a]'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <GitMerge size={14} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
              <span className={`text-xs font-semibold ${themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ccc]'}`}>
                核心能力
              </span>
            </div>
            <ul className={`text-xs space-y-1 ml-6 list-disc ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>
              <li>多张图片融合，每张可指定不同关键词</li>
              <li>SVG 连接线可视化参考关系</li>
              <li>融合描述框统一描述目标效果</li>
              <li>右侧面板调整关键词与画面尺寸</li>
            </ul>
          </div>
        </div>
      </SubSection>

      <SubSection title="使用步骤" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <div className="space-y-3">
            {[
              { step: 1, text: '在画布左上角折叠工具栏中开启「参考融合」开关', highlight: '工具栏 → 参考融合' },
              { step: 2, text: '按住 Ctrl 键（Mac: Cmd 键），依次点击要融合的图片', highlight: 'Ctrl + 点击' },
              { step: 3, text: '选中的图片左上角显示金色编号徽章，SVG 连接线指向输出框', highlight: '可视化连接' },
              { step: 4, text: '在右侧图像生成面板中，为每张参考图输入关键词描述', highlight: '关键词输入' },
              { step: 5, text: '在融合描述框中输入整体融合目标描述', highlight: '融合描述' },
              { step: 6, text: '点击「融合生成」按钮，AI 根据参考图 + 关键词 + 融合描述生成新图', highlight: '生成结果' },
            ].map((item) => (
              <div key={item.step} className={`flex items-start gap-3 p-2 rounded-lg ${
                themeStyle === 'monochrome' ? 'bg-white' : 'bg-[#1a1a1a]'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  themeStyle === 'monochrome'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-[#d4af37]/15 text-[#d4af37]'
                }`}>{item.step}</div>
                <div className="flex-1">
                  <p className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ccc]'}`}>{item.text}</p>
                  <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-xs font-medium ${
                    themeStyle === 'monochrome'
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-[#2a2a2a] text-[#888]'
                  }`}>{item.highlight}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SubSection>

      <SubSection title="参考类型与强度" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <p className={`text-xs mb-3 ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>
            融合模式下，每张参考图还可以通过右侧面板设置参考类型和强度：
          </p>
          <div className="space-y-2">
            {[
              { type: '风格参考', desc: '融合参考图的风格、色调、艺术风格', strength: '30-60% 效果较佳' },
              { type: '构图参考', desc: '融合参考图的构图、布局、空间结构', strength: '40-70% 效果较佳' },
              { type: '角色参考', desc: '融合参考图中的角色形象和人物特征', strength: '50-80% 效果较佳' },
              { type: '图像适配器', desc: '高度还原参考图中的核心视觉元素', strength: '60-90% 效果较佳' },
            ].map((ref) => (
              <div key={ref.type} className={`p-3 rounded-lg border ${
                themeStyle === 'monochrome'
                  ? 'bg-white border-gray-200'
                  : 'bg-[#1a1a1a] border-[#2a2a2a]'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold ${
                    themeStyle === 'monochrome' ? 'text-gray-800' : 'text-[#e0e0e0]'
                  }`}>{ref.type}</span>
                </div>
                <p className={`text-xs mb-1 ${themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'}`}>{ref.desc}</p>
                <p className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#666]'}`}>
                  推荐强度：{ref.strength}
                </p>
              </div>
            ))}
          </div>
        </div>
      </SubSection>
    </div>
  );
}

function PsdEditorSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Layers size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        PSD 图层编辑器
      </SectionTitle>

      <SubSection title="功能概览" themeStyle={themeStyle}>
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <p className={`text-xs leading-relaxed mb-3 ${
            themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'
          }`}>
            PSD 图层编辑器采用智能背景移除 + 连通域分析技术，确保每个元素的完整性。每个图层输出为全画布透明 PNG，便于 Photoshop 中叠加编辑。
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className={`text-center p-2 rounded-lg ${
              themeStyle === 'monochrome' ? 'bg-white' : 'bg-[#1a1a1a]'
            }`}>
              <div className={`text-lg font-bold ${
                themeStyle === 'monochrome' ? 'text-yellow-600' : 'text-[#d4af37]'
              }`}>5</div>
              <div className={`text-xs ${
                themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
              }`}>背景检测模式</div>
            </div>
            <div className={`text-center p-2 rounded-lg ${
              themeStyle === 'monochrome' ? 'bg-white' : 'bg-[#1a1a1a]'
            }`}>
              <div className={`text-lg font-bold ${
                themeStyle === 'monochrome' ? 'text-yellow-600' : 'text-[#d4af37]'
              }`}>V4</div>
              <div className={`text-xs ${
                themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
              }`}>图层命名规范</div>
            </div>
            <div className={`text-center p-2 rounded-lg ${
              themeStyle === 'monochrome' ? 'bg-white' : 'bg-[#1a1a1a]'
            }`}>
              <div className={`text-lg font-bold ${
                themeStyle === 'monochrome' ? 'text-yellow-600' : 'text-[#d4af37]'
              }`}>3</div>
              <div className={`text-xs ${
                themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
              }`}>导出模式</div>
            </div>
          </div>
        </div>
      </SubSection>

      <SubSection title="使用步骤" themeStyle={themeStyle}>
        <div className="space-y-0">
          {[
            { step: '1', title: '在画布中选中一张图片', desc: '点击画布上的图片将其选中' },
            { step: '2', title: '选择 PSD 下载模式', desc: '点击下载按钮，选择 PSD 格式' },
            { step: '3', title: '选择导出模式', desc: '基础 / 专业 / 工作室 三种模式' },
            { step: '4', title: '点击确认，等待分析', desc: 'AI 自动分析图片结构并分割图层' },
          ].map((item, i) => (
            <div key={item.step} className="flex items-start gap-3 relative">
              {i < 3 && (
                <div className={`absolute left-[15px] top-[32px] w-px h-[calc(100%-16px)] ${
                  themeStyle === 'monochrome' ? 'bg-gray-200' : 'bg-[#2a2a2a]'
                }`} />
              )}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold z-10 ${
                themeStyle === 'monochrome'
                  ? 'bg-yellow-100 text-yellow-700 border border-yellow-300'
                  : 'bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40'
              }`}>
                {item.step}
              </div>
              <div className="pb-4">
                <span className={`text-xs font-semibold ${
                  themeStyle === 'monochrome' ? 'text-gray-800' : 'text-[#e0e0e0]'
                }`}>{item.title}</span>
                <p className={`text-xs mt-0.5 ${
                  themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
                }`}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SubSection>

      <SubSection title="导出模式对比" themeStyle={themeStyle}>
        <div className="space-y-2">
          {[
            {
              mode: '基础',
              name: '基础模式',
              desc: '原图 + 白色背景 + 注释层，安全快速导出',
              features: ['保留原图', '白色背景层', '注释说明'],
              recommended: false,
            },
            {
              mode: '专业',
              name: '专业模式',
              desc: '背景移除 + 连通域分析 + 语义命名 + 背景重建',
              features: ['智能背景移除', '语义图层命名', '背景重建', 'V4 XMP元数据'],
              recommended: true,
            },
            {
              mode: '工作室',
              name: '工作室模式',
              desc: '专业模式全部功能 + 阴影估算 + 语义分组 + 质量评分',
              features: ['阴影/反射层', '语义分组', '质量评分', '完整V4清单'],
              recommended: false,
            },
          ].map((item) => (
            <div key={item.mode} className={`p-4 rounded-xl border relative ${
              item.recommended
                ? themeStyle === 'monochrome'
                  ? 'bg-yellow-50 border-yellow-300'
                  : 'bg-[#d4af37]/5 border-[#d4af37]/40'
                : themeStyle === 'monochrome'
                  ? 'bg-white border-gray-200'
                  : 'bg-[#1a1a1a] border-[#2a2a2a]'
            }`}>
              {item.recommended && (
                <span className={`absolute -top-2 right-3 px-2 py-0.5 rounded-full text-xs font-bold ${
                  themeStyle === 'monochrome'
                    ? 'bg-yellow-400 text-yellow-900'
                    : 'bg-[#d4af37] text-black'
                }`}>推荐</span>
              )}
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-sm font-bold ${
                  item.recommended
                    ? themeStyle === 'monochrome' ? 'text-yellow-700' : 'text-[#d4af37]'
                    : themeStyle === 'monochrome' ? 'text-gray-800' : 'text-white'
                }`}>{item.mode}</span>
                <span className={`text-xs ${
                  themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
                }`}>{item.name}</span>
              </div>
              <p className={`text-xs mb-2 ${
                themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
              }`}>{item.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {item.features.map((f) => (
                  <span key={f} className={`px-2 py-0.5 rounded text-xs ${
                    item.recommended
                      ? themeStyle === 'monochrome'
                        ? 'bg-yellow-200/60 text-yellow-800'
                        : 'bg-[#d4af37]/15 text-[#d4af37]'
                      : themeStyle === 'monochrome'
                        ? 'bg-gray-100 text-gray-600'
                        : 'bg-[#222] text-[#aaa]'
                  }`}>{f}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SubSection>

      <SubSection title="V4 图层命名规范" themeStyle={themeStyle}>
        <div className={`rounded-lg overflow-hidden border ${
          themeStyle === 'monochrome' ? 'border-gray-200' : 'border-[#2a2a2a]'
        }`}>
          <table className="w-full text-xs">
            <thead>
              <tr className={themeStyle === 'monochrome' ? 'bg-gray-100' : 'bg-[#111]'}>
                <th className={`text-left px-3 py-2 font-semibold ${
                  themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ccc]'
                }`}>前缀</th>
                <th className={`text-left px-3 py-2 font-semibold ${
                  themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ccc]'
                }`}>类型</th>
                <th className={`text-left px-3 py-2 font-semibold ${
                  themeStyle === 'monochrome' ? 'text-gray-700' : 'text-[#ccc]'
                }`}>示例</th>
              </tr>
            </thead>
            <tbody>
              {[
            { prefix: 'bg/', type: '背景层', example: 'bg/main' },
            { prefix: 'subject/', type: '主体层', example: 'subject/1/person' },
            { prefix: 'text/', type: '文字层', example: 'text/1/标题' },
            { prefix: 'fx/', type: '阴影/特效', example: 'fx/shadow/1' },
            { prefix: 'deco/', type: '装饰层', example: 'deco/1/丝带' },
              ].map((row, i) => (
                <tr key={row.prefix} className={`border-t ${
                  themeStyle === 'monochrome' ? 'border-gray-100' : 'border-[#1a1a1a]'
                } ${i % 2 === 0 ? (themeStyle === 'monochrome' ? 'bg-white' : 'bg-[#0a0a0a]') : ''}`}>
                  <td className={`px-3 py-2 font-mono ${
                    themeStyle === 'monochrome' ? 'text-yellow-600' : 'text-[#d4af37]'
                  }`}>{row.prefix}</td>
                  <td className={`px-3 py-2 ${
                    themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'
                  }`}>{row.type}</td>
                  <td className={`px-3 py-2 font-mono ${
                    themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#777]'
                  }`}>{row.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SubSection>
    </div>
  );
}

function ChangelogSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <BookOpen size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        更新日志
      </SectionTitle>

      <div className="space-y-4">
        {/* v2.2.0 */}
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              themeStyle === 'monochrome'
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-[#d4af37]/15 text-[#d4af37]'
            }`}>v2.2.0</span>
            <span className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'}`}>最新版本</span>
          </div>
          <div className="space-y-2">
            {[
              { type: 'feat', text: '灵感提示词库提示词管理面板 - 一键插入、分类管理、资源库、图片识词四大功能' },
              { type: 'feat', text: '参考融合（Ctrl+点击融合）- 画布中选择多图，SVG 连线可视化，关键词驱动的融合生成' },
              { type: 'feat', text: '参考图片增强 - 4种参考类型（风格/构图/角色/IP适配器）+ 独立强度滑块' },
              { type: 'feat', text: 'SVG 矢量化导出 - 快速/专业/工作室 三种模式替代原栅格化功能' },
              { type: 'feat', text: '图片来源标签 - 生成/上传/编辑/矢量化四种来源标识' },
              { type: 'feat', text: '折叠工具栏 - 所有功能按钮整合到画布左上角，悬停展开，移开收起' },
              { type: 'fix', text: '生成数量 x2/x3/x4 不生效问题修复' },
              { type: 'fix', text: 'SVG 融合连接线不显示问题修复 - 移入 transform 容器内，统一坐标空间' },
              { type: 'fix', text: '视觉提示词模型同步 - 支持第三方模型提供商自动同步' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 mt-0.5 ${
                  item.type === 'feat'
                    ? (themeStyle === 'monochrome' ? 'bg-green-100 text-green-700' : 'bg-green-500/15 text-green-400')
                    : (themeStyle === 'monochrome' ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/15 text-blue-400')
                }`}>{item.type === 'feat' ? '功能' : item.type === 'fix' ? '修复' : item.type}</span>
                <span className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* v2.1.0 */}
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              themeStyle === 'monochrome'
                ? 'bg-gray-200 text-gray-600'
                : 'bg-[#2a2a2a] text-[#888]'
            }`}>v2.1.0</span>
          </div>
          <div className="space-y-2">
            {[
              { type: 'feat', text: 'PSD 三种导出模式（基础/专业/工作室）+ V4 规范图层命名' },
              { type: 'feat', text: '人工智能视觉分析图片结构 (/api/analyze-psd)' },
              { type: 'feat', text: '提示词优化 - 增强/扩展/精简三种模式' },
              { type: 'feat', text: '智能体联网思考模式' },
              { type: 'feat', text: '画布工具栏 - 上传/缩放/重置视图' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 mt-0.5 ${
                  item.type === 'feat'
                    ? (themeStyle === 'monochrome' ? 'bg-green-100 text-green-700' : 'bg-green-500/15 text-green-400')
                    : (themeStyle === 'monochrome' ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/15 text-blue-400')
                }`}>{item.type === 'feat' ? '功能' : item.type === 'fix' ? '修复' : item.type}</span>
                <span className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* v2.0.0 */}
        <div className={`rounded-xl p-4 border ${
          themeStyle === 'monochrome' ? 'bg-gray-50 border-gray-200' : 'bg-[#111] border-[#2a2a2a]'
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              themeStyle === 'monochrome'
                ? 'bg-gray-200 text-gray-600'
                : 'bg-[#2a2a2a] text-[#888]'
            }`}>v2.0.0</span>
          </div>
          <div className="space-y-2">
            {[
              { type: 'feat', text: '无限画布 - 拖拽/缩放/多选/框选/编辑模式' },
              { type: 'feat', text: '多模型支持 - 图像与对话模型统一接入' },
              { type: 'feat', text: '智能聊天面板 - 支持模型对话与图像理解' },
              { type: 'feat', text: '图片操作工具栏 - 放大/去背景/擦除/蒙版/扩展/裁切/下载' },
              { type: 'feat', text: '黑白/彩色双主题风格切换' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 mt-0.5 ${
                  item.type === 'feat'
                    ? (themeStyle === 'monochrome' ? 'bg-green-100 text-green-700' : 'bg-green-500/15 text-green-400')
                    : (themeStyle === 'monochrome' ? 'bg-blue-100 text-blue-700' : 'bg-blue-500/15 text-blue-400')
                }`}>{item.type === 'feat' ? '功能' : item.type === 'fix' ? '修复' : item.type}</span>
                <span className={`text-xs ${themeStyle === 'monochrome' ? 'text-gray-600' : 'text-[#999]'}`}>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutsSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Keyboard size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        快捷键
      </SectionTitle>

      <SubSection title="画布操作" themeStyle={themeStyle}>
        <div className={`rounded-lg border overflow-hidden ${
          themeStyle === 'monochrome' ? 'border-gray-200' : 'border-[#2a2a2a]'
        }`}>
          <ShortcutRow shortcut="Space + 拖动" description="抓手工具平移画布" themeStyle={themeStyle} />
          <ShortcutRow shortcut="滚轮" description="缩放画布" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Ctrl + 点击" description="选择参考图片（融合模式） / 多选图片" themeStyle={themeStyle} />
          <ShortcutRow shortcut="ESC" description="退出编辑模式 / 取消选择 / 关闭弹出面板" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Delete / Backspace" description="删除选中图片" themeStyle={themeStyle} />
        </div>
      </SubSection>

      <SubSection title="编辑模式" themeStyle={themeStyle}>
        <div className={`rounded-lg border overflow-hidden ${
          themeStyle === 'monochrome' ? 'border-gray-200' : 'border-[#2a2a2a]'
        }`}>
          <ShortcutRow shortcut="ESC" description="退出当前编辑模式" themeStyle={themeStyle} />
          <ShortcutRow shortcut="[ / ]" description="调整画笔大小" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Enter" description="确认当前操作" themeStyle={themeStyle} />
        </div>
      </SubSection>

      <SubSection title="面板操作" themeStyle={themeStyle}>
        <div className={`rounded-lg border overflow-hidden ${
          themeStyle === 'monochrome' ? 'border-gray-200' : 'border-[#2a2a2a]'
        }`}>
          <ShortcutRow shortcut="Ctrl + G" description="切换生成面板" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Ctrl + Shift + C" description="切换聊天面板" themeStyle={themeStyle} />
        </div>
      </SubSection>
    </div>
  );
}

function TipsSection({ themeStyle }: { themeStyle: string }) {
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Lightbulb size={18} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
        使用技巧
      </SectionTitle>

      <div className="space-y-3">
        {[
          {
            title: '提示词越具体，效果越好',
            desc: '描述画面主体、风格、光影、色调等细节。例如：「一只金色的凤凰在暗夜中展翅，周围飘散着火花，电影级光影，8K超高清」比「一只凤凰」效果好得多。',
            icon: <Pen size={14} />,
          },
          {
            title: '善用提示词优化器',
            desc: '在聊天面板中使用提示词优化功能，输入简短描述后选择"增强"模式，AI 会自动补充细节和构图要素，大幅提升出图质量。',
            icon: <Wand2 size={14} />,
          },
          {
            title: '提示词库一键插入',
            desc: '点击左上角工具栏的灵感提示词库按钮，从资源库中一键插入专业提示词到创意描述，省去手动输入的麻烦。',
            icon: <Sparkles size={14} />,
          },
          {
            title: 'Ctrl+点击参考融合',
            desc: '开启参考融合模式后，Ctrl+点击选择多张图片，为每张图输入关键词描述，融合生成全新的创意图片。适合混搭风格、组合元素。',
            icon: <GitMerge size={14} />,
          },
          {
            title: 'PSD 导出选择专业模式',
            desc: '专业模式使用智能背景移除 + 连通域分析，能保证元素完整性，比基础模式提供更专业的分层效果，适合大多数场景。',
            icon: <Layers size={14} />,
          },
          {
            title: '参考图类型精准控制',
            desc: '上传参考图后选择合适的参考类型：风格参考参照色调和画风，构图参考参照布局，角色参考还原人物，IP适配器高度还原核心视觉元素。调节强度滑块微调效果。',
            icon: <ImageIcon size={14} />,
          },
          {
            title: 'SVG 矢量化导出',
            desc: '选中图片后点击“矢量化”按钮，将位图转为 SVG 矢量格式。快速模式 16 色快速转换，专业模式 32 色优化，工作室模式 48 色带形状识别和元数据。',
            icon: <Shapes size={14} />,
          },
          {
            title: '画布支持自由排版',
            desc: '所有生成的图片可以自由拖拽、缩放、排列。支持框选多图批量操作，适合对比和拼合方案展示。',
            icon: <Move size={14} />,
          },
        ].map((tip) => (
          <div key={tip.title} className={`p-4 rounded-xl border ${
            themeStyle === 'monochrome'
              ? 'bg-white border-gray-200'
              : 'bg-[#1a1a1a] border-[#2a2a2a]'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-6 h-6 rounded flex items-center justify-center ${
                themeStyle === 'monochrome'
                  ? 'text-yellow-600 bg-yellow-100'
                  : 'text-[#d4af37] bg-[#d4af37]/15'
              }`}>{tip.icon}</div>
              <span className={`text-xs font-semibold ${
                themeStyle === 'monochrome' ? 'text-gray-800' : 'text-[#e0e0e0]'
              }`}>{tip.title}</span>
            </div>
            <p className={`text-xs leading-relaxed ${
              themeStyle === 'monochrome' ? 'text-gray-500' : 'text-[#888]'
            }`}>{tip.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function HelpGuide({ isOpen, onClose, themeStyle = 'gold' }: HelpGuideProps) {
  const [activeSection, setActiveSection] = useState<SectionId>('canvas');

  if (!isOpen) return null;

  const toggleSection = (id: SectionId) => {
    setActiveSection(id);
  };

  const renderSection = () => {
    switch (activeSection) {
      case 'canvas': return <CanvasSection themeStyle={themeStyle} />;
      case 'generate': return <GenerateSection themeStyle={themeStyle} />;
      case 'chat': return <ChatSection themeStyle={themeStyle} />;
      case 'omp': return <OmpSection themeStyle={themeStyle} />;
      case 'fusion': return <FusionSection themeStyle={themeStyle} />;
      case 'psd-editor': return <PsdEditorSection themeStyle={themeStyle} />;
      case 'shortcuts': return <ShortcutsSection themeStyle={themeStyle} />;
      case 'tips': return <TipsSection themeStyle={themeStyle} />;
      case 'changelog': return <ChangelogSection themeStyle={themeStyle} />;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className={`relative w-[90vw] max-w-[960px] h-[85vh] rounded-2xl border shadow-2xl flex overflow-hidden ${
        themeStyle === 'monochrome'
          ? 'bg-white border-gray-200'
          : 'bg-[#0a0a0a] border-[#d4af37]/20'
      }`}>
        {/* Left Sidebar - Navigation */}
        <div className={`w-[200px] flex-shrink-0 border-r flex flex-col ${
          themeStyle === 'monochrome'
            ? 'bg-gray-50 border-gray-200'
            : 'bg-[#0f0f0f] border-[#1a1a1a]'
        }`}>
          {/* Header */}
          <div className={`px-4 py-4 border-b ${
            themeStyle === 'monochrome' ? 'border-gray-200' : 'border-[#1a1a1a]'
          }`}>
            <div className="flex items-center gap-2">
              <BookOpen size={18} className={themeStyle === 'monochrome' ? 'text-yellow-600' : 'text-[#d4af37]'} />
              <div>
                <h2 className={`text-sm font-bold ${
                  themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
                }`}>使用指南</h2>
                <span className={`text-xs ${
                  themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#666]'
                }`}>使用指南</span>
              </div>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="flex-1 py-2 px-2 space-y-0.5">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => toggleSection(section.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all text-xs ${
                  activeSection === section.id
                    ? themeStyle === 'monochrome'
                      ? 'bg-yellow-100 text-yellow-800 font-semibold'
                      : 'bg-[#d4af37]/15 text-[#d4af37] font-semibold'
                    : themeStyle === 'monochrome'
                      ? 'text-gray-600 hover:bg-gray-100'
                      : 'text-[#888] hover:bg-[#1a1a1a] hover:text-white'
                }`}
              >
                <span className={activeSection === section.id && themeStyle !== 'monochrome' ? 'text-[#d4af37]' : ''}>
                  {section.icon}
                </span>
                <div className="flex flex-col">
                  <span>{section.title}</span>
                </div>
              </button>
            ))}
          </nav>

          {/* Version */}
          <div className={`px-4 py-3 border-t text-center ${
            themeStyle === 'monochrome' ? 'border-gray-200' : 'border-[#1a1a1a]'
          }`}>
            <span className={`text-xs ${
              themeStyle === 'monochrome' ? 'text-gray-400' : 'text-[#555]'
            }`}>{APP_VERSION_LABEL}</span>
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Content Header */}
          <div className={`px-6 py-3 border-b flex items-center justify-between flex-shrink-0 ${
            themeStyle === 'monochrome' ? 'border-gray-200' : 'border-[#1a1a1a]'
          }`}>
            <div className="flex items-center gap-2">
              <Info size={14} className={themeStyle === 'monochrome' ? 'text-yellow-500' : 'text-[#d4af37]'} />
              <span className={`text-sm font-semibold ${
                themeStyle === 'monochrome' ? 'text-gray-900' : 'text-white'
              }`}>
                {SECTIONS.find(s => s.id === activeSection)?.title}
              </span>
            </div>
            <button
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-all ${
                themeStyle === 'monochrome'
                  ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  : 'text-[#666] hover:text-white hover:bg-[#1a1a1a]'
              }`}
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5" style={{
            scrollbarWidth: 'thin',
            scrollbarColor: themeStyle === 'monochrome' ? '#d1d5db transparent' : '#333 transparent'
          }}>
            {renderSection()}
          </div>
        </div>
      </div>
    </div>
  );
}
