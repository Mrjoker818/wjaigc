'use client';

import { Info, FileText, X, Eraser, Brush, Scissors, ZoomIn, Pencil, Bot, Type, Scan, ShoppingBag, PenTool, Expand, MoreHorizontal } from 'lucide-react';
import { APP_VERSION_LABEL } from '@/config/app-meta';

interface CanvasHelpModalProps {
  mode: 'instructions' | 'changelog';
  isMonochrome: boolean;
  onClose: () => void;
}

export function CanvasHelpModal({ mode, isMonochrome, onClose }: CanvasHelpModalProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className={`relative rounded-2xl border shadow-2xl overflow-hidden ${isMonochrome ? 'bg-white border-gray-200' : 'bg-[#1a1a1a] border-[#444]'}`} style={{ width: 560, maxHeight: '80vh' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3 border-b ${isMonochrome ? 'border-gray-100' : 'border-white/[0.14]'}`}>
          <div className="flex items-center gap-2">
            {mode === 'instructions' ? <Info size={16} className={isMonochrome ? 'text-gray-700' : 'text-gold'} /> : <FileText size={16} className={isMonochrome ? 'text-gray-700' : 'text-gold'} />}
            <span className={`text-sm font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>{mode === 'instructions' ? '使用说明' : '更新内容'}</span>
          </div>
          <button onClick={onClose} className={`p-1 rounded-lg transition-colors ${isMonochrome ? 'text-blue-400 hover:text-blue-600 hover:bg-blue-50' : 'text-gold-muted/70 hover:text-white hover:bg-[#2a2a2a]'}`}><X size={16} /></button>
        </div>
        <div className={`overflow-y-auto ${isMonochrome ? 'text-gray-700' : 'text-text-bright'}`} style={{ maxHeight: 'calc(80vh - 52px)' }}>
          {mode === 'instructions' ? (
            <InstructionsContent isMonochrome={isMonochrome} />
          ) : (
            <ChangelogContent isMonochrome={isMonochrome} />
          )}
        </div>
      </div>
    </div>
  );
}

function HelpImage({ file, alt, isMonochrome }: { file: string; alt: string; isMonochrome: boolean }) {
  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.1)' }}>
      <img src={`/api/help-image?file=${file}`} alt={alt} className="w-full" loading="lazy" />
    </div>
  );
}

function ToolCard({ icon: Icon, title, desc, imageFile, detail, isMonochrome }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  desc: string;
  imageFile?: string;
  detail: string;
  isMonochrome: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 ${isMonochrome ? 'bg-gray-50' : 'bg-[#222]'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={13} className={isMonochrome ? 'text-gray-600' : 'text-gold'} />
        <span className={`text-xs font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>{title}</span>
        <span className={`text-xs ml-auto ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{desc}</span>
      </div>
      {imageFile && (
        <div className="rounded-lg overflow-hidden border mt-2" style={{ borderColor: isMonochrome ? '#e5e7eb' : 'rgba(255,255,255,0.08)' }}>
          <img src={`/api/help-image?file=${imageFile}`} alt={title} className="w-full" loading="lazy" />
        </div>
      )}
      <p className={`text-xs mt-1.5 ${isMonochrome ? 'text-gray-500' : 'text-gold-muted'}`}>{detail}</p>
    </div>
  );
}

function SimpleToolCard({ title, desc, isMonochrome }: { title: string; desc: string; isMonochrome: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={isMonochrome ? 'text-gray-600' : 'text-[#999]'}>{title}</span>
      <span className={`text-xs ${isMonochrome ? 'text-gray-400' : 'text-gold-muted/70'}`}>{desc}</span>
    </div>
  );
}

function InstructionsContent({ isMonochrome }: { isMonochrome: boolean }) {
  return (
    <div className="p-5 space-y-5">
      <HelpImage file="canvas-overview.jpeg" alt="画布概览" isMonochrome={isMonochrome} />

      {/* 画布操作 */}
      <div>
        <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-gold'}`}>画布操作</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {[['左键单击', '选择图片'], ['左键拖拽空白', '框选多图'], ['Ctrl+左键', '多选/参考融合'], ['Alt+左键', '标记参考图'], ['长按拖动图片', '移动图片'], ['空格+拖动', '平移画布'], ['滚轮', '缩放画布'], ['右键', '上下文菜单'], ['Ctrl+D', '复制图片'], ['Ctrl+Z', '撤回操作'], ['ESC', '退出编辑'], ['Delete', '删除图片']].map(([k, v]) => (
            <SimpleToolCard key={k} title={k} desc={v} isMonochrome={isMonochrome} />
          ))}
        </div>
      </div>

      <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-white/[0.06]'}`} />

      {/* 图片编辑工具 */}
      <div>
        <div className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isMonochrome ? 'text-gray-400' : 'text-gold'}`}>图片编辑工具</div>
        <div className="space-y-3">
          <ToolCard icon={Eraser} title="擦除" desc="画笔涂抹消除，自动修复" imageFile="erase-tool.jpeg" detail="涂抹要消除的区域，本地 LaMa/ZITS/Anime-Lama 优先修复，AI 智能修复兜底，所有工具统一使用图像生成面板当前模型，支持任务取消" isMonochrome={isMonochrome} />
          <ToolCard icon={Brush} title="蒙版" desc="精准遮罩，AI 重新生成" imageFile="mask-tool.jpeg" detail="画白色区域标记要重新生成的部分，输入提示词描述，AI 仅在蒙版区域生成新内容" isMonochrome={isMonochrome} />
          <ToolCard icon={Scissors} title="移除背景" desc="一键去背景，输出主体图+蒙版" imageFile="remove-bg.jpeg" detail="自动分离主体与背景，同时生成透明底主体图和黑白蒙版图，本地 BiRefNet/U2Net/Silueta 优先，AI 原生透明输出+边缘颜色混合修复，消除抠图锯齿" isMonochrome={isMonochrome} />
          <ToolCard icon={ZoomIn} title="放大" desc="无损放大，智能补细节" imageFile="upscale.jpeg" detail="AI 放大支持 4 种模型（302 超级放大 V2 / 放大 V6 / 基础放大 / ESRGAN 高清增强），倍率 2x/4x，支持 PNG/JPG/WEBP 输出" isMonochrome={isMonochrome} />
          <ToolCard icon={Pencil} title="语言修图" desc="自然语言描述修改图片" imageFile="lang-edit.jpeg" detail="用自然语言描述修改意图，支持 OpenAI（可区域涂抹）+ Gemini（智能理解），自动裁切适配比例" isMonochrome={isMonochrome} />
          <ToolCard icon={Bot} title="Agent 编排" desc="智能编排多工具" detail="AI 自动选择和组合工具（修图/生图/分析/调色），多轮决策直至完成" isMonochrome={isMonochrome} />
          <ToolCard icon={Type} title="字境大师 Pro" desc="AI 字体设计与生成" detail="9 大字体风格库 + 12 种使用场景 + AI 设计方案生成，支持即梦提示词增强和黑底白字/透明Logo模式" isMonochrome={isMonochrome} />
          <ToolCard icon={Scan} title="精修引擎" desc="产品商业级精修" detail="标准/专家双模式，AI 商业级产品精修，适合电商和广告场景" isMonochrome={isMonochrome} />
          <ToolCard icon={ShoppingBag} title="品牌电商" desc="电商视觉生成" detail="品牌电商视觉内容生成，商品场景图/营销素材一键出图" isMonochrome={isMonochrome} />
          <ToolCard icon={PenTool} title="SVG 智能描摹" desc="位图转矢量图" imageFile="svg-trace.jpeg" detail="彩色/黑白两种矢量化模式，多级质量预设（快速/均衡/高清/极致），智能放大+降噪预处理，AI 专业 SVG 提示词工程+安全过滤+重试机制，路径数质量控制，SVG 标准化输出" isMonochrome={isMonochrome} />
          <ToolCard icon={Expand} title="扩展" desc="向四周延伸画面" imageFile="extend.jpeg" detail="支持缩放比例（1x-4x）和画面比例预设，AI 自动补齐延伸内容" isMonochrome={isMonochrome} />

          {/* 其他工具简表 */}
          <div className={`rounded-lg p-3 ${isMonochrome ? 'bg-gray-50' : 'bg-[#222]'}`}>
            <div className="flex items-center gap-2 mb-2">
              <MoreHorizontal size={13} className={isMonochrome ? 'text-gray-600' : 'text-gold'} />
              <span className={`text-xs font-semibold ${isMonochrome ? 'text-gray-900' : 'text-white'}`}>其他工具</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {[['编辑元素', '按元素智能分层'], ['多角度', '多视角旋转生成'], ['图转3D工厂', '生成3D模型预览'], ['裁切', '自由/预设比例裁切'], ['Logo Pro', 'AI Logo设计与生成'], ['图生图', '基于原图风格生成'], ['品牌工厂', '品牌视觉资产生成'], ['下载', 'PNG/SVG/PSD多格式']].map(([k, v]) => (
                <SimpleToolCard key={k} title={k} desc={v} isMonochrome={isMonochrome} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-white/[0.06]'}`} />

      {/* 组与参考图 */}
      <div>
        <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-gold'}`}>组与参考图</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {[['多图右键', '创建组'], ['组标题栏', '折叠/展开组'], ['长按组标题', '移动整个组'], ['Alt+左键', '标记参考图（紫色R）'], ['参考图标记', '自动添加到描述'], ['Backspace', '删除参考图标记']].map(([k, v]) => (
            <SimpleToolCard key={k} title={k} desc={v} isMonochrome={isMonochrome} />
          ))}
        </div>
      </div>

      <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-white/[0.06]'}`} />

      {/* Oh My Prompt */}
      <div>
        <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-gold'}`}>Oh My Prompt</div>
        <HelpImage file="oh-my-prompt.jpeg" alt="Oh My Prompt" isMonochrome={isMonochrome} />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
          {[['资源库', '精选提示词模板'], ['图片识词', 'AI 识别图片关键词'], ['提示词优化', '增强/扩展/精简'], ['一键发送', '填充到生成面板']].map(([k, v]) => (
            <SimpleToolCard key={k} title={k} desc={v} isMonochrome={isMonochrome} />
          ))}
        </div>
      </div>

      <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-white/[0.06]'}`} />

      {/* 左上角工具栏 */}
      <div>
        <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-gold'}`}>左上角工具栏</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {[['Oh My Prompt', '提示词管理'], ['参考融合', 'Ctrl+Click融合生成'], ['设置', '应用配置'], ['主题切换', '黑白/彩色切换'], ['用户管理', '多用户管理'], ['项目数据', '项目保存加载'], ['管理员系统', 'API配置（管理员）'], ['使用说明', '操作与更新']].map(([k, v]) => (
            <SimpleToolCard key={k} title={k} desc={v} isMonochrome={isMonochrome} />
          ))}
        </div>
      </div>

      <div className={`h-px ${isMonochrome ? 'bg-gray-100' : 'bg-white/[0.06]'}`} />

      {/* 底部工具栏 */}
      <div>
        <div className={`text-xs font-semibold uppercase tracking-wider mb-2.5 ${isMonochrome ? 'text-gray-400' : 'text-gold'}`}>底部工具栏</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {[['选择工具', '点击/框选图片'], ['抓手工具', '平移画布'], ['图片上传', '上传本地图片'], ['图像生成器', 'AI图像生成（金色按钮）'], ['视频生成器', 'AI视频生成与编辑'], ['语言修图', '自然语言修改图片'], ['Agent编排', '智能编排多工具'], ['Logo Pro', 'AI Logo设计与生成'], ['品牌工厂', '品牌视觉资产生成'], ['精修引擎', '产品商业级精修'], ['字境大师', 'AI字体设计与生成'], ['节点编辑器', '可视化工作流编排'], ['六面体', '6面贴图预览'], ['缩放控制', '放大/缩小/重置']].map(([k, v]) => (
            <SimpleToolCard key={k} title={k} desc={v} isMonochrome={isMonochrome} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChangelogContent({ isMonochrome }: { isMonochrome: boolean }) {
  return (
    <div className="p-5">
      <div className={`text-xs font-semibold uppercase tracking-wider mb-3 ${isMonochrome ? 'text-gray-400' : 'text-gold'}`}>{APP_VERSION_LABEL}</div>
      <div className="space-y-2.5">
        {[
          'v4.1.0 修复：生图数量>1时多图完整返回，不再丢失图片',
          'v4.1.0 修复：祛除背景操作正确作用于右键选中的图片',
          'v4.1.0 修复：快速创作高级模式不再卡在编译过程（超时保护）',
          'v4.1.0 修复：人物精修大师视觉检测真实生效，不再返回固定扫描结果',
          'v4.1.0 修复：元素拆解忠于原图元素，不再整体重绘',
          'v4.1.0 放大升级：AI放大新增 302 基础放大 + ESRGAN 高清增强，共 4 个模型',
          'v4.1.0 修复：标注修改大图自动缩小，不再报 size exceeds',
          'v4.1.0 修复：SVG 元素编辑选中图形有金色高亮反馈',
          '视频生成：文生视频/图生视频/首尾帧/多参考图，6种API协议适配，20+视频模型',
          '视频编辑：语言描述修改视频内容，视频延长，黑金主题播放器',
          'Logo Pro：AI Logo设计与生成，5种风格方向+10种行业类型+3种视觉风格',
          '品牌工厂：品牌DNA定义+品牌视觉资产生成，配色/字体/调性一站式管理',
          '节点编辑器：可视化工作流DAG编排，30+节点类型，AI自然语言建图，ComfyUI导入',
          '字境大师 Pro：9大字体风格库+12种使用场景+AI设计方案生成+即梦提示词增强',
          '精修引擎：标准/专家双模式，AI商业级产品精修',
          '品牌电商：品牌电商视觉内容生成，商品场景图/营销素材一键出图',
          '图片编辑：放大/移除背景/SVG描摹/擦除/蒙版/编辑元素/多角度/图转3D工厂/扩展/裁切/图生图',
          '移除背景：同时生成透明底主体图+黑白蒙版图，BiRefNet/U2Net/Silueta优先+边缘修复',
          '擦除：LaMa/ZITS/Anime-Lama优先，AI修复+边界扩散兜底',
          '蒙版：AI重新生成指定区域，精确蒙版合成+边缘羽化过渡',
          '语言修图：支持OpenAI+Gemini，自动裁切适配比例',
          'Agent编排：智能选择修图/生图/分析/调色工具，多轮循环决策',
          'SVG智能描摹：彩色/黑白模式，AI专业SVG提示词+安全过滤+重试',
          '任务管理：统一任务注册中心，SSE实时推送，支持取消和排队',
          'Ctrl+Z无限撤回，组功能（右键创建/折叠/拖动），Alt+Click标记参考图',
          '下载：PNG/SVG/PSD三种格式，PSD支持Basic/Pro/Studio模式',
          '服务器端API密钥管理+通用多提供商兼容层+协议验证',
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${isMonochrome ? 'bg-gray-400' : 'bg-gold'}`} />
            <span className="text-xs">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
