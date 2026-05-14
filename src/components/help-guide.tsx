'use client';

import { useState } from 'react';
import {
  Move, Sparkles, MessageSquare, Layers, Keyboard, Lightbulb,
  BookOpen, X, Info, Pen, Wand2, ImagePlus, GitMerge, ImageIcon,
  ZoomIn, Eraser, Maximize, Download, Shapes, Settings, Database,
  FileBox, ChevronRight, Check
} from 'lucide-react';
import { APP_VERSION_LABEL } from '@/config/app-meta';

// ─── Types ──────────────────────────────────────────────────────

type SectionId = 'canvas' | 'generate' | 'img2img' | 'chat' | 'tools' | 'project' | 'admin' | 'shortcuts' | 'tips' | 'changelog';

interface Section {
  id: SectionId;
  title: string;
  icon: React.ReactNode;
}

interface HelpGuideProps {
  isOpen: boolean;
  onClose: () => void;
  themeStyle?: 'gold' | 'monochrome';
}

const SECTIONS: Section[] = [
  { id: 'canvas', title: '无限画布', icon: <Move size={16} /> },
  { id: 'generate', title: '图像生成', icon: <Sparkles size={16} /> },
  { id: 'img2img', title: '图生图', icon: <ImagePlus size={16} /> },
  { id: 'chat', title: '智能对话', icon: <MessageSquare size={16} /> },
  { id: 'tools', title: '图片编辑工具', icon: <Eraser size={16} /> },
  { id: 'project', title: '项目与文件', icon: <FileBox size={16} /> },
  { id: 'admin', title: '管理员系统', icon: <Settings size={16} /> },
  { id: 'shortcuts', title: '快捷键', icon: <Keyboard size={16} /> },
  { id: 'tips', title: '使用技巧', icon: <Lightbulb size={16} /> },
  { id: 'changelog', title: '更新日志', icon: <BookOpen size={16} /> },
];

// ─── Theme helpers ──────────────────────────────────────────────

interface TH { s: string }
function th(themeStyle: string): TH {
  const isGold = themeStyle !== 'monochrome';
  return {
    s: isGold ? 'gold' : 'mono',
  };
}

// Reusable styled components
function Card({ children, className = '', themeStyle }: { children: React.ReactNode; className?: string; themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div className={`rounded-xl border p-4 ${isGold ? 'bg-[#111] border-[#2a2a2a]' : 'bg-white border-gray-200'} ${className}`}>
      {children}
    </div>
  );
}

function CardHighlight({ children, className = '', themeStyle }: { children: React.ReactNode; className?: string; themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div className={`rounded-xl border p-4 ${isGold ? 'bg-[#d4af37]/5 border-[#d4af37]/30' : 'bg-yellow-50 border-yellow-200'} ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ children, themeStyle }: { children: React.ReactNode; themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div className={`flex items-center gap-2 mb-4 pb-3 border-b ${isGold ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
      {children}
    </div>
  );
}

function SubTitle({ children, themeStyle }: { children: React.ReactNode; themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <h4 className={`text-xs font-semibold mb-2 ${isGold ? 'text-[#d4af37]' : 'text-yellow-600'}`}>{children}</h4>
  );
}

function Text({ children, themeStyle, muted = false }: { children: React.ReactNode; themeStyle: string; muted?: boolean }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <span className={`text-xs leading-relaxed ${muted ? (isGold ? 'text-[#888]' : 'text-gray-500') : (isGold ? 'text-[#ccc]' : 'text-gray-700')}`}>
      {children}
    </span>
  );
}

function Tag({ children, color = 'gold', themeStyle }: { children: React.ReactNode; color?: 'gold' | 'green' | 'blue' | 'purple' | 'red' | 'cyan'; themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  const styles: Record<string, string> = {
    gold: isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-yellow-100 text-yellow-700',
    green: isGold ? 'bg-green-500/15 text-green-400' : 'bg-green-100 text-green-700',
    blue: isGold ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-100 text-blue-700',
    purple: isGold ? 'bg-purple-500/15 text-purple-400' : 'bg-purple-100 text-purple-700',
    red: isGold ? 'bg-red-500/15 text-red-400' : 'bg-red-100 text-red-700',
    cyan: isGold ? 'bg-cyan-500/15 text-cyan-400' : 'bg-cyan-100 text-cyan-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[color]}`}>{children}</span>;
}

function StepItem({ step, title, desc, themeStyle, isLast = false }: { step: string; title: string; desc: string; themeStyle: string; isLast?: boolean }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div className="flex items-start gap-3 relative">
      {!isLast && (
        <div className={`absolute left-[15px] top-[32px] w-px h-[calc(100%-16px)] ${isGold ? 'bg-[#2a2a2a]' : 'bg-gray-200'}`} />
      )}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold z-10 ${
        isGold ? 'bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40' : 'bg-yellow-100 text-yellow-700 border border-yellow-300'
      }`}>
        {step}
      </div>
      <div className="pb-4">
        <div className={`text-xs font-semibold ${isGold ? 'text-[#e0e0e0]' : 'text-gray-800'}`}>{title}</div>
        <Text themeStyle={themeStyle} muted>{desc}</Text>
      </div>
    </div>
  );
}

function FeatureItem({ icon, title, desc, themeStyle }: { icon: React.ReactNode; title: string; desc: string; themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div className={`p-3 rounded-lg ${isGold ? 'bg-[#0d0d0d]' : 'bg-gray-50'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-6 h-6 rounded flex items-center justify-center ${isGold ? 'text-[#d4af37] bg-[#d4af37]/15' : 'text-yellow-600 bg-yellow-100'}`}>
          {icon}
        </div>
        <span className={`text-xs font-semibold ${isGold ? 'text-[#e0e0e0]' : 'text-gray-800'}`}>{title}</span>
      </div>
      <Text themeStyle={themeStyle} muted>{desc}</Text>
    </div>
  );
}

function ShortcutRow({ shortcut, description, themeStyle }: { shortcut: string; description: string; themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 border-b last:border-b-0 ${isGold ? 'border-[#1a1a1a]' : 'border-gray-100'}`}>
      <span className={`text-xs ${isGold ? 'text-[#999]' : 'text-gray-600'}`}>{description}</span>
      <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${
        isGold ? 'bg-[#1a1a1a] text-[#d4af37] border border-[#d4af37]/30' : 'bg-gray-100 text-gray-700 border border-gray-300'
      }`}>{shortcut}</span>
    </div>
  );
}

// ─── Section Components ─────────────────────────────────────────

function CanvasSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Move size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>无限画布</span>
      </SectionTitle>

      <div className="space-y-4">
        <SubTitle themeStyle={themeStyle}>核心交互</SubTitle>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: <Move size={14} />, title: '自由拖拽', desc: '图片可随意拖拽、缩放、排列' },
            { icon: <ZoomIn size={14} />, title: '缩放画布', desc: '滚轮缩放，Space+拖动平移' },
            { icon: <Layers size={14} />, title: '多选框选', desc: 'Ctrl+点击多选，拖拽空白框选' },
            { icon: <Maximize size={14} />, title: '编辑模式', desc: '擦除/蒙版/扩展/图生图/裁切' },
          ].map(item => (
            <FeatureItem key={item.title} {...item} themeStyle={themeStyle} />
          ))}
        </div>

        <SubTitle themeStyle={themeStyle}>底部工具栏</SubTitle>
        <div className="grid grid-cols-3 gap-2">
          {[
            { icon: <Move size={12} />, title: '选择/平移', desc: '切换选择和平移工具' },
            { icon: <ImageIcon size={12} />, title: '上传图片', desc: '从本地上传图片到画布' },
            { icon: <Layers size={12} />, title: '图层管理', desc: '查看图片分组和图层信息' },
            { icon: <ZoomIn size={12} />, title: '缩放控制', desc: '放大/缩小/百分比/重置' },
            { icon: <Eraser size={12} />, title: '编辑工具', desc: '选中图片后显示编辑工具' },
            { icon: <Download size={12} />, title: '下载导出', desc: 'PNG/SVG/PSD 多格式' },
          ].map(item => (
            <FeatureItem key={item.title} {...item} themeStyle={themeStyle} />
          ))}
        </div>

        <SubTitle themeStyle={themeStyle}>Ctrl+Z 无限撤回</SubTitle>
        <Card themeStyle={themeStyle}>
          <Text themeStyle={themeStyle}>支持无限步数撤回，纯内存同步管理，流畅无卡顿，无 toast 提示干扰。每次图片操作（生成、上传、编辑、删除等）都会自动记录到历史栈。</Text>
        </Card>
      </div>
    </div>
  );
}

function GenerateSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Sparkles size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>图像生成</span>
      </SectionTitle>

      <div className="space-y-4">
        <SubTitle themeStyle={themeStyle}>生成流程</SubTitle>
        {[
          { s: '1', t: '选择模型', d: '从管理员配置的模型列表中选择图像模型' },
          { s: '2', t: '输入创意描述', d: '描述你想生成的画面，越具体效果越好' },
          { s: '3', t: '设置参数', d: '选择画面比例、生图质量、产品品类' },
          { s: '4', t: '点击生成', d: '等待 AI 生成，结果自动添加到画布', last: true },
        ].map(item => (
          <StepItem key={item.s} step={item.s} title={item.t} desc={item.d} themeStyle={themeStyle} isLast={!!item.last} />
        ))}

        <SubTitle themeStyle={themeStyle}>高级设置</SubTitle>
        <div className="grid grid-cols-2 gap-2">
          <Card themeStyle={themeStyle}>
            <div className={`text-xs font-semibold mb-1 ${isGold ? 'text-[#d4af37]' : 'text-yellow-600'}`}>画面比例</div>
            <Text themeStyle={themeStyle} muted>带比例图形预览，直观展示比例样式</Text>
          </Card>
          <Card themeStyle={themeStyle}>
            <div className={`text-xs font-semibold mb-1 ${isGold ? 'text-[#d4af37]' : 'text-yellow-600'}`}>生图质量</div>
            <Text themeStyle={themeStyle} muted>根据所选模型支持的质量设置调整</Text>
          </Card>
        </div>

        <SubTitle themeStyle={themeStyle}>提示词优化</SubTitle>
        <CardHighlight themeStyle={themeStyle}>
          <Text themeStyle={themeStyle}>在聊天面板中使用提示词优化功能，支持三种模式：</Text>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Tag color="green" themeStyle={themeStyle}>增强模式</Tag>
            <Tag color="blue" themeStyle={themeStyle}>扩展模式</Tag>
            <Tag color="purple" themeStyle={themeStyle}>精简模式</Tag>
          </div>
          <Text themeStyle={themeStyle} muted>优化结果一键发送到图像生成面板的创意描述</Text>
        </CardHighlight>
      </div>
    </div>
  );
}

function Img2ImgSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <ImagePlus size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>图生图</span>
      </SectionTitle>

      <div className="space-y-4">
        <SubTitle themeStyle={themeStyle}>工作原理</SubTitle>
        <CardHighlight themeStyle={themeStyle}>
          <Text themeStyle={themeStyle}>以当前图片为参考图，调整参考参数和关键词，生成新的图片。AI 会根据你选择的参考类别和强度，在原图基础上生成风格/构图/色彩等维度的变化。</Text>
        </CardHighlight>

        <SubTitle themeStyle={themeStyle}>6大参考类别</SubTitle>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: <Sparkles size={12} />, title: '风格', desc: '保持或变化艺术风格', tag: 'style' },
            { icon: <Maximize size={12} />, title: '构图', desc: '保持或重新构图', tag: 'composition' },
            { icon: <ImageIcon size={12} />, title: '场景', desc: '保持或重新设定场景', tag: 'scene' },
            { icon: <Wand2 size={12} />, title: '色彩', desc: '保持或调整色调氛围', tag: 'color' },
            { icon: <Shapes size={12} />, title: '主体', desc: '保持或替换画面主体', tag: 'subject' },
            { icon: <Pen size={12} />, title: '细节', desc: '保持或丰富画面细节', tag: 'detail' },
          ].map(item => (
            <Card key={item.title} themeStyle={themeStyle} className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-5 h-5 rounded flex items-center justify-center ${isGold ? 'text-[#d4af37] bg-[#d4af37]/15' : 'text-yellow-600 bg-yellow-100'}`}>
                  {item.icon}
                </div>
                <span className={`text-xs font-semibold ${isGold ? 'text-[#e0e0e0]' : 'text-gray-800'}`}>{item.title}</span>
                <Tag color="gold" themeStyle={themeStyle}>{item.tag}</Tag>
              </div>
              <Text themeStyle={themeStyle} muted>{item.desc}</Text>
            </Card>
          ))}
        </div>

        <SubTitle themeStyle={themeStyle}>使用步骤</SubTitle>
        {[
          { s: '1', t: '选中图片', d: '在画布中点击选中一张图片' },
          { s: '2', t: '点击图生图按钮', d: '在顶部工具栏中点击 ImagePlus 图标' },
          { s: '3', t: '调整参考参数', d: '选择参考类别，调整每类强度滑块 (0-100%)' },
          { s: '4', t: '输入关键词并生成', d: '输入创意关键词，点击生成按钮', last: true },
        ].map(item => (
          <StepItem key={item.s} step={item.s} title={item.t} desc={item.d} themeStyle={themeStyle} isLast={!!item.last} />
        ))}

        <SubTitle themeStyle={themeStyle}>快捷功能</SubTitle>
        <div className="space-y-2">
          <Card themeStyle={themeStyle} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Tag color="gold" themeStyle={themeStyle}>当前图片描述</Tag>
            </div>
            <Text themeStyle={themeStyle} muted>一键填充图片原始描述到关键词输入框</Text>
          </Card>
          <Card themeStyle={themeStyle} className="p-3">
            <div className="flex items-center gap-2 mb-1">
              <Tag color="red" themeStyle={themeStyle}>反向提示词</Tag>
            </div>
            <Text themeStyle={themeStyle} muted>自动填充默认反向提示词（低质量/模糊/变形等），用户可编辑修改</Text>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ChatSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <MessageSquare size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>智能对话</span>
      </SectionTitle>

      <div className="space-y-4">
        <SubTitle themeStyle={themeStyle}>功能特性</SubTitle>
        <div className="grid grid-cols-2 gap-2">
          <FeatureItem icon={<MessageSquare size={14} />} title="AI 对话" desc="支持 Gemini 等大语言模型对话" themeStyle={themeStyle} />
          <FeatureItem icon={<Wand2 size={14} />} title="提示词优化" desc="增强/扩展/精简三种模式" themeStyle={themeStyle} />
          <FeatureItem icon={<ImageIcon size={14} />} title="图像理解" desc="AI 可识别和分析图片内容" themeStyle={themeStyle} />
          <FeatureItem icon={<Sparkles size={14} />} title="联网思考" desc="Agent 联网搜索模式" themeStyle={themeStyle} />
        </div>

        <SubTitle themeStyle={themeStyle}>提示词优化流程</SubTitle>
        {[
          { s: '1', t: '输入简短描述', d: '在聊天面板输入框中描述你的创意' },
          { s: '2', t: '选择优化模式', d: '点击提示词优化按钮，选择增强/扩展/精简' },
          { s: '3', t: '一键发送到生成面板', d: '优化结果一键填充到图像生成面板', last: true },
        ].map(item => (
          <StepItem key={item.s} step={item.s} title={item.t} desc={item.d} themeStyle={themeStyle} isLast={!!item.last} />
        ))}
      </div>
    </div>
  );
}

function ToolsSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Eraser size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>图片编辑工具</span>
      </SectionTitle>

      <div className="space-y-4">
        <SubTitle themeStyle={themeStyle}>选中图片后顶部工具栏</SubTitle>
        <div className="space-y-2">
          {[
            { icon: <ZoomIn size={14} />, title: '放大', desc: 'AI 无损放大，支持 upscayl 分块放大（有 GPU 时自动启用）或 AI 整图放大（兜底方案），保持原图元素和风格不变，增大尺寸并增加细节', tags: ['AI增强', '分块'] },
            { icon: <Eraser size={14} />, title: '移除背景', desc: '自动把主体和背景分开，一键删掉杂乱背景', tags: ['AI分割'] },
            { icon: <Eraser size={14} />, title: '擦除', desc: '画笔涂抹消除并自动无缝补上新的画面，支持画笔大小调节', tags: ['画笔', 'AI修复'] },
            { icon: <Shapes size={14} />, title: '蒙版', desc: '给图片加"透明遮罩膜"，精准控制编辑范围，支持画笔/橡皮擦/撤销', tags: ['画笔', '提示词'] },
            { icon: <Layers size={14} />, title: '编辑元素', desc: '根据图片元素进行分层处理，支持导出 PSD', tags: ['分层', 'PSD'] },
            { icon: <Maximize size={14} />, title: '扩展', desc: '往图片四周延伸画面，支持缩放比例(1x-4x)和画面比例选择', tags: ['比例', '扩展'] },
            { icon: <ImagePlus size={14} />, title: '图生图', desc: '6大参考类别 + 独立强度滑块，精准控制生成效果', tags: ['参考', '强度'] },
            { icon: <Download size={14} />, title: '下载', desc: 'PNG/SVG/PSD 多格式，PSD 支持基础/专业/工作室模式', tags: ['多格式'] },
          ].map(item => (
            <Card key={item.title} themeStyle={themeStyle} className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-5 h-5 rounded flex items-center justify-center ${isGold ? 'text-[#d4af37] bg-[#d4af37]/15' : 'text-yellow-600 bg-yellow-100'}`}>
                  {item.icon}
                </div>
                <span className={`text-xs font-semibold ${isGold ? 'text-[#e0e0e0]' : 'text-gray-800'}`}>{item.title}</span>
                <div className="flex gap-1 ml-auto">
                  {item.tags.map(tag => (
                    <Tag key={tag} color={tag === 'AI增强' || tag === 'AI分割' || tag === 'AI修复' ? 'green' : tag === '分块' || tag === '分层' ? 'purple' : tag === '提示词' || tag === '参考' ? 'blue' : tag === '强度' ? 'cyan' : 'gold'} themeStyle={themeStyle}>{tag}</Tag>
                  ))}
                </div>
              </div>
              <Text themeStyle={themeStyle} muted>{item.desc}</Text>
            </Card>
          ))}
        </div>

        <SubTitle themeStyle={themeStyle}>放大功能详解</SubTitle>
        <CardHighlight themeStyle={themeStyle}>
          <div className="space-y-3">
            <div>
              <div className={`text-xs font-semibold mb-1 ${isGold ? 'text-[#d4af37]' : 'text-yellow-600'}`}>策略 A：upscayl 分块放大（推荐）</div>
              <Text themeStyle={themeStyle} muted>将图片切成 2x2/2x3/3x3 网格块，每块用 Real-ESRGAN 神经网络放大，最后无缝拼接。像素级忠实原图，细节最丰富。需要 GPU 环境。</Text>
            </div>
            <div>
              <div className={`text-xs font-semibold mb-1 ${isGold ? 'text-[#d4af37]' : 'text-yellow-600'}`}>策略 B：AI 整图放大（兜底）</div>
              <Text themeStyle={themeStyle} muted>用 AI 视觉模型描述原图，再通过 images/generations + 极低 strength 生成超清版本。无需 GPU，在 upscayl 不可用时自动启用。</Text>
            </div>
          </div>
        </CardHighlight>
      </div>
    </div>
  );
}

function ProjectSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <FileBox size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>项目与文件</span>
      </SectionTitle>

      <div className="space-y-4">
        <SubTitle themeStyle={themeStyle}>项目管理</SubTitle>
        <Card themeStyle={themeStyle}>
          <Text themeStyle={themeStyle}>支持多项目管理，每个项目独立保存画布数据和图片。项目数据自动同步到服务器数据库，确保重新部署后数据不丢失。</Text>
        </Card>

        <SubTitle themeStyle={themeStyle}>.wujie 文件格式</SubTitle>
        <CardHighlight themeStyle={themeStyle}>
          <Text themeStyle={themeStyle}>项目导出为 .wujie 文件，实际为精美的 HTML 网页图册。用浏览器直接打开即可浏览，包含：</Text>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Tag color="gold" themeStyle={themeStyle}>用户信息</Tag>
            <Tag color="green" themeStyle={themeStyle}>图片画廊</Tag>
            <Tag color="blue" themeStyle={themeStyle}>生成参数</Tag>
            <Tag color="purple" themeStyle={themeStyle}>模型标签</Tag>
          </div>
        </CardHighlight>

        <SubTitle themeStyle={themeStyle}>PSD 导出模式</SubTitle>
        <div className="space-y-2">
          {[
            { mode: '基础', desc: '原图 + 白色背景 + 注释层，安全快速', features: ['保留原图', '白色背景层', '注释说明'], rec: false },
            { mode: '专业', desc: '背景移除 + 连通域分析 + 语义命名 + 背景重建', features: ['智能背景移除', '语义图层命名', '背景重建', 'V4 XMP元数据'], rec: true },
            { mode: '工作室', desc: '专业模式全部 + 阴影估算 + 语义分组 + 质量评分', features: ['阴影/反射层', '语义分组', '质量评分', '完整V4清单'], rec: false },
          ].map(item => (
            <Card key={item.mode} themeStyle={themeStyle} className={`relative ${item.rec ? (isGold ? '!border-[#d4af37]/40 !bg-[#d4af37]/5' : '!border-yellow-300 !bg-yellow-50') : ''}`}>
              {item.rec && (
                <span className={`absolute -top-2 right-3 px-2 py-0.5 rounded-full text-xs font-bold ${isGold ? 'bg-[#d4af37] text-black' : 'bg-yellow-400 text-yellow-900'}`}>推荐</span>
              )}
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-xs font-bold ${item.rec ? (isGold ? 'text-[#d4af37]' : 'text-yellow-700') : (isGold ? 'text-white' : 'text-gray-800')}`}>{item.mode}</span>
              </div>
              <Text themeStyle={themeStyle} muted>{item.desc}</Text>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {item.features.map(f => (
                  <Tag key={f} color={item.rec ? 'gold' : 'blue'} themeStyle={themeStyle}>{f}</Tag>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <SubTitle themeStyle={themeStyle}>V4 图层命名规范</SubTitle>
        <div className={`rounded-lg overflow-hidden border ${isGold ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
          <table className="w-full text-xs">
            <thead>
              <tr className={isGold ? 'bg-[#111]' : 'bg-gray-100'}>
                <th className={`text-left px-3 py-2 font-semibold ${isGold ? 'text-[#ccc]' : 'text-gray-700'}`}>前缀</th>
                <th className={`text-left px-3 py-2 font-semibold ${isGold ? 'text-[#ccc]' : 'text-gray-700'}`}>类型</th>
                <th className={`text-left px-3 py-2 font-semibold ${isGold ? 'text-[#ccc]' : 'text-gray-700'}`}>示例</th>
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
                <tr key={row.prefix} className={`border-t ${isGold ? 'border-[#1a1a1a]' : 'border-gray-100'} ${i % 2 === 0 ? (isGold ? 'bg-[#0a0a0a]' : '') : ''}`}>
                  <td className={`px-3 py-2 font-mono ${isGold ? 'text-[#d4af37]' : 'text-yellow-600'}`}>{row.prefix}</td>
                  <td className={`px-3 py-2 ${isGold ? 'text-[#999]' : 'text-gray-600'}`}>{row.type}</td>
                  <td className={`px-3 py-2 font-mono ${isGold ? 'text-[#777]' : 'text-gray-500'}`}>{row.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Settings size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>管理员系统</span>
      </SectionTitle>

      <div className="space-y-4">
        <SubTitle themeStyle={themeStyle}>API 提供商管理</SubTitle>
        <Card themeStyle={themeStyle}>
          <Text themeStyle={themeStyle}>管理员统一配置 API 密钥，用户无需手动输入。支持5种模型类型：</Text>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Tag color="green" themeStyle={themeStyle}>图像模型</Tag>
            <Tag color="blue" themeStyle={themeStyle}>LLM 模型</Tag>
            <Tag color="purple" themeStyle={themeStyle}>3D 模型</Tag>
            <Tag color="cyan" themeStyle={themeStyle}>矢量模型</Tag>
            <Tag color="gold" themeStyle={themeStyle}>图片分层模型</Tag>
          </div>
        </Card>

        <SubTitle themeStyle={themeStyle}>关键能力</SubTitle>
        <div className="grid grid-cols-2 gap-2">
          <FeatureItem icon={<Settings size={14} />} title="自动识别模型" desc="添加 API 后自动识别可用模型" themeStyle={themeStyle} />
          <FeatureItem icon={<Sparkles size={14} />} title="模型选择" desc="管理员手动选择启用的模型" themeStyle={themeStyle} />
          <FeatureItem icon={<Database size={14} />} title="连接测试" desc="测试 API 连通性和余额" themeStyle={themeStyle} />
          <FeatureItem icon={<Wand2 size={14} />} title="用量分析" desc="API 余额与用量统计" themeStyle={themeStyle} />
        </div>

        <SubTitle themeStyle={themeStyle}>数据持久化</SubTitle>
        <Card themeStyle={themeStyle}>
          <Text themeStyle={themeStyle}>所有管理员数据（用户、API 配置、系统设置）存储在 PostgreSQL 数据库中，重新部署后数据不丢失。</Text>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Tag color="green" themeStyle={themeStyle}>数据库优先</Tag>
            <Tag color="blue" themeStyle={themeStyle}>文件系统兜底</Tag>
            <Tag color="purple" themeStyle={themeStyle}>双写保证一致性</Tag>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ShortcutsSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Keyboard size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>快捷键</span>
      </SectionTitle>

      <div className="space-y-4">
        <SubTitle themeStyle={themeStyle}>画布操作</SubTitle>
        <div className={`rounded-lg border overflow-hidden ${isGold ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
          <ShortcutRow shortcut="Space + 拖动" description="抓手工具平移画布" themeStyle={themeStyle} />
          <ShortcutRow shortcut="滚轮" description="缩放画布" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Alt + 点击" description="标记图片为参考图" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Ctrl + 点击" description="多选图片" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Ctrl + Z" description="撤回操作（无限步数）" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Ctrl + D" description="复制选中图片" themeStyle={themeStyle} />
          <ShortcutRow shortcut="ESC" description="退出编辑模式 / 取消选择 / 关闭弹出面板" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Delete / Backspace" description="删除选中图片" themeStyle={themeStyle} />
        </div>

        <SubTitle themeStyle={themeStyle}>编辑模式</SubTitle>
        <div className={`rounded-lg border overflow-hidden ${isGold ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
          <ShortcutRow shortcut="ESC" description="退出当前编辑模式" themeStyle={themeStyle} />
          <ShortcutRow shortcut="[ / ]" description="调整画笔大小" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Enter" description="确认当前操作" themeStyle={themeStyle} />
        </div>

        <SubTitle themeStyle={themeStyle}>面板操作</SubTitle>
        <div className={`rounded-lg border overflow-hidden ${isGold ? 'border-[#2a2a2a]' : 'border-gray-200'}`}>
          <ShortcutRow shortcut="Ctrl + G" description="切换生成面板" themeStyle={themeStyle} />
          <ShortcutRow shortcut="Ctrl + Shift + C" description="切换聊天面板" themeStyle={themeStyle} />
        </div>
      </div>
    </div>
  );
}

function TipsSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <Lightbulb size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>使用技巧</span>
      </SectionTitle>

      <div className="space-y-2">
        {[
          { icon: <Pen size={14} />, title: '提示词越具体，效果越好', desc: '描述画面主体、风格、光影、色调等细节。例如："一只金色的凤凰在暗夜中展翅，周围飘散着火花，电影级光影，8K超高清"比"一只凤凰"效果好得多。' },
          { icon: <Wand2 size={14} />, title: '善用提示词优化器', desc: '在聊天面板中使用提示词优化功能，输入简短描述后选择"增强"模式，AI 会自动补充细节和构图要素。' },
          { icon: <ImagePlus size={14} />, title: '图生图精准控制', desc: '6大参考类别（风格/构图/场景/色彩/主体/细节）每类独立强度滑块，精确控制生成效果。用"当前图片描述"一键填充原始描述。' },
          { icon: <ZoomIn size={14} />, title: '放大选好策略', desc: '有 GPU 环境下 upscayl 分块放大效果最佳（像素级忠实），无 GPU 时自动使用 AI 整图放大。' },
          { icon: <Layers size={14} />, title: 'PSD 导出选专业模式', desc: '专业模式使用智能背景移除 + 连通域分析，保证元素完整性，比基础模式提供更专业的分层效果。' },
          { icon: <FileBox size={14} />, title: '.wujie 文件可浏览器打开', desc: '导出的项目文件是精美的 HTML 网页图册，可直接在浏览器中浏览，也可以重新导入恢复项目。' },
          { icon: <Move size={14} />, title: '画布自由排版与撤回', desc: '所有图片可自由拖拽、缩放、排列。Ctrl+Z 无限步数撤回，适合对比和拼合方案展示。' },
        ].map(tip => (
          <Card key={tip.title} themeStyle={themeStyle}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-6 h-6 rounded flex items-center justify-center ${isGold ? 'text-[#d4af37] bg-[#d4af37]/15' : 'text-yellow-600 bg-yellow-100'}`}>{tip.icon}</div>
              <span className={`text-xs font-semibold ${isGold ? 'text-[#e0e0e0]' : 'text-gray-800'}`}>{tip.title}</span>
            </div>
            <Text themeStyle={themeStyle} muted>{tip.desc}</Text>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ChangelogSection({ themeStyle }: { themeStyle: string }) {
  const isGold = themeStyle !== 'monochrome';
  return (
    <div>
      <SectionTitle themeStyle={themeStyle}>
        <BookOpen size={18} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
        <span className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>更新日志</span>
      </SectionTitle>

      <div className="space-y-4">
        {/* v2.7.0 */}
        <CardHighlight themeStyle={themeStyle}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${isGold ? 'bg-[#d4af37]/15 text-[#d4af37]' : 'bg-yellow-100 text-yellow-700'}`}>v2.7.0</span>
            <span className={`text-xs ${isGold ? 'text-[#888]' : 'text-gray-500'}`}>当前版本</span>
          </div>
          <div className="space-y-2">
            {[
              { type: 'feat', text: '客户端数据服务器同步 — 项目数据自动同步到数据库，重部署不丢失' },
              { type: 'feat', text: '.wujie 文件改为 HTML 格式导出 — 黑金配色网页图册，浏览器直接打开' },
              { type: 'feat', text: '图生图功能全面升级 — 6大参考类别 + 独立强度滑块 + 视觉描述增强' },
              { type: 'feat', text: '分块放大(Tile Upscale) — upscayl Real-ESRGAN 分块放大 + AI 兜底' },
              { type: 'fix', text: '图生图参考图 URL 可访问性修复 — 自动转换为公开 URL' },
              { type: 'fix', text: 'z-index 层级规范 — 重构全局 z-index 防止弹窗遮挡' },
              { type: 'fix', text: '组数据持久化修复 — beforeunload/退出登录/自动保存均正确同步' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 mt-0.5 ${
                  item.type === 'feat'
                    ? (isGold ? 'bg-green-500/15 text-green-400' : 'bg-green-100 text-green-700')
                    : (isGold ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-100 text-blue-700')
                }`}>{item.type === 'feat' ? '功能' : '修复'}</span>
                <span className={`text-xs ${isGold ? 'text-[#999]' : 'text-gray-600'}`}>{item.text}</span>
              </div>
            ))}
          </div>
        </CardHighlight>

        {/* v2.6.0 */}
        <Card themeStyle={themeStyle}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${isGold ? 'bg-[#2a2a2a] text-[#888]' : 'bg-gray-200 text-gray-600'}`}>v2.6.0</span>
          </div>
          <div className="space-y-2">
            {[
              { type: 'feat', text: '数据库持久化存储 — PostgreSQL 存储，读取先数据库后文件系统，写入双写' },
              { type: 'feat', text: 'API 兼容性修复 — fetchWithV1Retry 自动处理 /v1 兼容' },
              { type: 'feat', text: '管理员系统增强 — API 用量分析和余额显示' },
              { type: 'fix', text: '登录界面不显示问题修复 — authChecked 状态和认证门控' },
              { type: 'fix', text: '上传/生成图片后视图自动居中' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 mt-0.5 ${
                  item.type === 'feat'
                    ? (isGold ? 'bg-green-500/15 text-green-400' : 'bg-green-100 text-green-700')
                    : (isGold ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-100 text-blue-700')
                }`}>{item.type === 'feat' ? '功能' : '修复'}</span>
                <span className={`text-xs ${isGold ? 'text-[#999]' : 'text-gray-600'}`}>{item.text}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* v2.5.1 */}
        <Card themeStyle={themeStyle}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${isGold ? 'bg-[#2a2a2a] text-[#888]' : 'bg-gray-200 text-gray-600'}`}>v2.5.1</span>
          </div>
          <div className="space-y-2">
            {[
              { type: 'fix', text: '擦除/蒙版功能修复 — AI 生成 API + 蒙版合成策略' },
              { type: 'fix', text: '蒙版检测核心 Bug — 改用 RGB 亮度阈值判断' },
              { type: 'fix', text: '接口地址不再自动追加 /v1' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 mt-0.5 ${
                  isGold ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-100 text-blue-700'
                }`}>修复</span>
                <span className={`text-xs ${isGold ? 'text-[#999]' : 'text-gray-600'}`}>{item.text}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* v2.5.0 */}
        <Card themeStyle={themeStyle}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${isGold ? 'bg-[#2a2a2a] text-[#888]' : 'bg-gray-200 text-gray-600'}`}>v2.5.0</span>
          </div>
          <div className="space-y-2">
            {[
              { type: 'feat', text: '参考图与图生图6大类别统一' },
              { type: 'feat', text: '图片工具栏全面升级' },
              { type: 'feat', text: '管理员系统增强 — 通用模型类型、API用量分析' },
              { type: 'feat', text: '服务器端API密钥管理' },
              { type: 'fix', text: '所有编辑操作（除扩展和裁切）保持原图比例' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 mt-0.5 ${
                  item.type === 'feat'
                    ? (isGold ? 'bg-green-500/15 text-green-400' : 'bg-green-100 text-green-700')
                    : (isGold ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-100 text-blue-700')
                }`}>{item.type === 'feat' ? '功能' : '修复'}</span>
                <span className={`text-xs ${isGold ? 'text-[#999]' : 'text-gray-600'}`}>{item.text}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function HelpGuide({ isOpen, onClose, themeStyle = 'gold' }: HelpGuideProps) {
  const [activeSection, setActiveSection] = useState<SectionId>('canvas');

  if (!isOpen) return null;

  const isGold = themeStyle !== 'monochrome';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className={`relative w-[92vw] max-w-[1000px] h-[88vh] rounded-2xl border shadow-2xl flex overflow-hidden ${
        isGold ? 'bg-[#0a0a0a] border-[#d4af37]/20' : 'bg-white border-gray-200'
      }`}>
        {/* Left Sidebar */}
        <div className={`w-[180px] flex-shrink-0 border-r flex flex-col ${
          isGold ? 'bg-[#0d0d0d] border-[#1a1a1a]' : 'bg-gray-50 border-gray-200'
        }`}>
          {/* Header */}
          <div className={`px-4 py-4 border-b ${isGold ? 'border-[#1a1a1a]' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <BookOpen size={16} className={isGold ? 'text-[#d4af37]' : 'text-yellow-600'} />
              <div>
                <h2 className={`text-sm font-bold ${isGold ? 'text-white' : 'text-gray-900'}`}>使用指南</h2>
                <span className={`text-xs ${isGold ? 'text-[#555]' : 'text-gray-400'}`}>{APP_VERSION_LABEL}</span>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all text-xs ${
                  activeSection === section.id
                    ? isGold
                      ? 'bg-[#d4af37]/15 text-[#d4af37] font-semibold'
                      : 'bg-yellow-100 text-yellow-800 font-semibold'
                    : isGold
                      ? 'text-[#888] hover:bg-[#1a1a1a] hover:text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className={activeSection === section.id && isGold ? 'text-[#d4af37]' : ''}>
                  {section.icon}
                </span>
                <span>{section.title}</span>
              </button>
            ))}
          </nav>

          {/* Footer */}
          <div className={`px-4 py-3 border-t text-center ${isGold ? 'border-[#1a1a1a]' : 'border-gray-200'}`}>
            <span className={`text-xs ${isGold ? 'text-[#555]' : 'text-gray-400'}`}>{APP_VERSION_LABEL}</span>
          </div>
        </div>

        {/* Right Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Content Header */}
          <div className={`px-6 py-3 border-b flex items-center justify-between flex-shrink-0 ${isGold ? 'border-[#1a1a1a]' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <Info size={14} className={isGold ? 'text-[#d4af37]' : 'text-yellow-500'} />
              <span className={`text-sm font-semibold ${isGold ? 'text-white' : 'text-gray-900'}`}>
                {SECTIONS.find(s => s.id === activeSection)?.title}
              </span>
            </div>
            <button
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-all ${isGold ? 'text-[#666] hover:text-white hover:bg-[#1a1a1a]' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5" style={{
            scrollbarWidth: 'thin',
            scrollbarColor: isGold ? '#333 transparent' : '#d1d5db transparent'
          }}>
            {(() => {
              switch (activeSection) {
                case 'canvas': return <CanvasSection themeStyle={themeStyle} />;
                case 'generate': return <GenerateSection themeStyle={themeStyle} />;
                case 'img2img': return <Img2ImgSection themeStyle={themeStyle} />;
                case 'chat': return <ChatSection themeStyle={themeStyle} />;
                case 'tools': return <ToolsSection themeStyle={themeStyle} />;
                case 'project': return <ProjectSection themeStyle={themeStyle} />;
                case 'admin': return <AdminSection themeStyle={themeStyle} />;
                case 'shortcuts': return <ShortcutsSection themeStyle={themeStyle} />;
                case 'tips': return <TipsSection themeStyle={themeStyle} />;
                case 'changelog': return <ChangelogSection themeStyle={themeStyle} />;
              }
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
