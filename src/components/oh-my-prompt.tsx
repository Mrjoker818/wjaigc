'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Lightbulb, X, Upload, Wand2, Eye, Sparkles, Loader2, Copy, Check, Send, Image as ImageIcon, RotateCcw, ChevronDown, ChevronUp, Zap, GripHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// Types
type OmpActiveTab = 'vision' | 'agent';

// Storage keys
const OMP_KEY = 'wujie_oh_my_prompt';

interface OmpSettings {
  visionDefaultFormat: string;
}

const DEFAULT_SETTINGS: OmpSettings = { visionDefaultFormat: 'comma' };

function loadSettings(): OmpSettings {
  try {
    const saved = localStorage.getItem(OMP_KEY);
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}
function saveSettings(settings: Partial<OmpSettings>) {
  try {
    const current = loadSettings();
    localStorage.setItem(OMP_KEY, JSON.stringify({ ...current, ...settings }));
  } catch {}
}

// API Functions
async function analyzeVisionPromptInternal(imageDataUrl: string): Promise<VisionApiResultData> {
  const res = await fetch('/api/vision-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: imageDataUrl }), // no model — API auto-detects
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Vision analysis failed');
  }
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '分析失败');
  return data.data as VisionApiResultData;
}

async function optimizeWithAgent(prompt: string, history: Array<{role:string, content:string}>, signal?: AbortSignal, onChunk?: (text: string) => void): Promise<string> {
  const res = await fetch('/api/optimize-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, history }),
    signal,
  });
  if (!res.ok) throw new Error('Optimization failed');
  
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let result = '';
  
  if (reader && onChunk) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      result += text;
      onChunk(result);
    }
  } else {
    result = await res.text();
  }
  return result;
}

// ============================================
// Vision Tab - 识词 (图片关键词提取)
// ============================================
interface VisionKeywordCategory {
  key: string;
  label: string;
  hint?: string;
  text: string;
}

// Format a structured JSON block (zh_json / en_json) into a readable prompt string
function formatStructuredJson(json?: Record<string, string | string[]>): string {
  if (!json) return '';
  const parts: string[] = [];
  for (const [, value] of Object.entries(json)) {
    if (Array.isArray(value)) {
      if (value.length) parts.push(value.join(', '));
    } else if (typeof value === 'string' && value.trim()) {
      parts.push(value.trim());
    }
  }
  return parts.join(', ');
}

// Build categorized keyword blocks from the rich API result
function buildVisionCategories(result: VisionApiResultData): VisionKeywordCategory[] {
  const categories: VisionKeywordCategory[] = [];

  if (result.zh?.prompt) {
    categories.push({ key: 'zh', label: '中文提示词', hint: result.zh.title, text: result.zh.prompt });
  }
  if (result.en?.prompt) {
    categories.push({ key: 'en', label: '英文提示词', hint: result.en.title, text: result.en.prompt });
  }
  if (result.zh_style_tags?.length) {
    categories.push({ key: 'zh_tags', label: '中文风格标签', text: result.zh_style_tags.join(', ') });
  }
  if (result.en_style_tags?.length) {
    categories.push({ key: 'en_tags', label: '英文风格标签', text: result.en_style_tags.join(', ') });
  }
  const zhStruct = formatStructuredJson(result.zh_json);
  if (zhStruct) {
    categories.push({ key: 'zh_json', label: '中文结构化描述', hint: '主体/动作/环境/光影等', text: zhStruct });
  }
  const enStruct = formatStructuredJson(result.en_json);
  if (enStruct) {
    categories.push({ key: 'en_json', label: '英文结构化描述', hint: 'subject/action/lighting…', text: enStruct });
  }
  const jsonStruct = formatStructuredJson(result.json_prompt);
  if (jsonStruct && !zhStruct && !enStruct) {
    categories.push({ key: 'json', label: '结构化描述', text: jsonStruct });
  }
  // legacy backward-compat
  if (!categories.length && result.keywords?.length) {
    categories.push({ key: 'keywords', label: '关键词', text: result.keywords.join(', ') });
  }
  return categories;
}

interface VisionTabProps {
  initialImageUrl?: string;
  onInsertPrompt: (prompt: string, negative?: string) => void;
  onOptimizePrompt: (prompt: string, mode: string) => void;
  externalResult?: VisionApiResultData | null;
  externalAnalyzing?: boolean;
  floating?: boolean;
}

function VisionTab({ initialImageUrl, onInsertPrompt, onOptimizePrompt, externalResult, externalAnalyzing, floating }: VisionTabProps) {
  const [imagePreview, setImagePreview] = useState<string>(initialImageUrl || '');
  const [internalAnalyzing, setInternalAnalyzing] = useState(false);
  const [internalResult, setInternalResult] = useState<VisionApiResultData | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sentKey, setSentKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prefer external result/state (from canvas right-click flow) if present, else internal
  const result = externalResult ?? internalResult;
  const isAnalyzing = externalAnalyzing || internalAnalyzing;

  useEffect(() => {
    if (initialImageUrl && !imagePreview) {
      setImagePreview(initialImageUrl);
    }
  }, [initialImageUrl]);

  const handleFileUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
      setInternalResult(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!imagePreview || isAnalyzing) return;
    setInternalAnalyzing(true);
    setInternalResult(null);
    try {
      const data = await analyzeVisionPromptInternal(imagePreview);
      setInternalResult(data);
    } catch (error) {
      console.error('Vision analysis error:', error);
      alert(error instanceof Error ? error.message : '图片识词失败，请重试');
    } finally {
      setInternalAnalyzing(false);
    }
  }, [imagePreview, isAnalyzing]);

  const categories = result ? buildVisionCategories(result) : [];

  const handleCopyCategory = useCallback(async (cat: VisionKeywordCategory) => {
    if (!cat.text) return;
    try {
      await navigator.clipboard.writeText(cat.text);
      setCopiedKey(cat.key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // clipboard may be blocked in some contexts — fallback to a hidden textarea
      const ta = document.createElement('textarea');
      ta.value = cat.text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopiedKey(cat.key); setTimeout(() => setCopiedKey(null), 2000); } catch {}
      document.body.removeChild(ta);
    }
  }, []);

  const handleSendCategory = useCallback((cat: VisionKeywordCategory) => {
    if (!cat.text) return;
    onInsertPrompt(cat.text, result?.negative_prompt);
    setSentKey(cat.key);
    setTimeout(() => setSentKey(null), 2000);
  }, [onInsertPrompt, result?.negative_prompt]);

  const resetTab = useCallback(() => {
    setImagePreview('');
    setInternalResult(null);
  }, []);

  const accent = floating ? '#d4af37' : undefined;

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <div className="flex-1 overflow-y-auto space-y-3">
        {/* Image Upload Area */}
        <div 
          className={`relative border-2 border-dashed rounded-xl transition-all cursor-pointer overflow-hidden
            ${floating
              ? (imagePreview ? 'border-[#d4af37]/40' : 'border-[#444] hover:border-[#d4af37]/60 hover:bg-[#222]')
              : (imagePreview ? 'border-primary/30' : 'border-border hover:border-primary/50 hover:bg-muted/30')}`}
          style={{ minHeight: imagePreview ? '0' : '120px' }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
          
          {imagePreview ? (
            <div className="relative group">
              <img src={imagePreview} alt="Upload" className="w-full h-32 object-contain bg-muted/30" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span className="text-white text-xs">点击更换图片</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); resetTab(); }}
                className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white hover:bg-black/80">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className={`flex flex-col items-center justify-center py-8 gap-2 ${floating ? 'text-gray-400' : 'text-muted-foreground'}`}>
              <Upload className="w-8 h-8 opacity-50" />
              <span className="text-xs">点击上传图片，AI自动识别关键词</span>
            </div>
          )}
        </div>

        {/* Analyze Button */}
        {imagePreview && !isAnalyzing && !result && (
          <Button onClick={handleAnalyze} className={`w-full gap-2 ${floating ? 'bg-[#d4af37] text-black hover:bg-[#c9a227]' : ''}`}>
            <Eye className="w-4 h-4" />开始识词
          </Button>
        )}
        
        {isAnalyzing && (
          <div className={`flex items-center justify-center gap-2 py-4 ${floating ? 'text-gray-300' : 'text-muted-foreground'}`}>
            <Loader2 className={`w-5 h-5 animate-spin ${floating ? 'text-[#d4af37]' : 'text-primary'}`} />
            <span className="text-sm">AI正在分析图片...</span>
          </div>
        )}

        {/* Result — categorized keyword cards */}
        {result && !isAnalyzing && (
          <div className="space-y-3">
            <div className={`flex items-center justify-between text-xs ${floating ? 'text-gray-400' : 'text-muted-foreground'}`}>
              <span>识别到 {categories.length} 类关键词，选择需要的发送或复制</span>
              {typeof result.confidence === 'number' && result.confidence > 0 && (
                <span className={floating ? 'text-[#d4af37]' : 'text-primary'}>置信度 {Math.round(result.confidence * 100)}%</span>
              )}
            </div>

            {categories.length === 0 && (
              <div className={`rounded-lg p-3 text-xs ${floating ? 'bg-[#2a2a2a] text-gray-400' : 'bg-muted/50 text-muted-foreground'}`}>
                未识别到有效关键词，请重试或更换图片。
              </div>
            )}

            {categories.map(cat => {
              const isCopied = copiedKey === cat.key;
              const isSent = sentKey === cat.key;
              return (
                <div key={cat.key}
                  className={`rounded-lg p-3 border ${floating ? 'bg-[#222] border-[#3a3a3a]' : 'bg-muted/40 border-border'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`text-xs font-semibold ${floating ? 'text-[#d4af37]' : 'text-primary'}`}>{cat.label}</span>
                      {cat.hint && (
                        <span className={`text-[10px] truncate ${floating ? 'text-gray-500' : 'text-muted-foreground'}`}>· {cat.hint}</span>
                      )}
                    </div>
                  </div>
                  <p className={`text-xs leading-relaxed whitespace-pre-wrap break-words ${floating ? 'text-gray-200' : 'text-foreground'}`}>
                    {cat.text}
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className={`flex-1 gap-1.5 h-8 text-xs ${floating ? 'bg-transparent border-[#444] text-gray-200 hover:bg-[#333] hover:text-white' : ''}`}
                      onClick={() => handleCopyCategory(cat)}
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {isCopied ? '已复制' : '复制关键词'}
                    </Button>
                    <Button
                      size="sm"
                      className={`flex-1 gap-1.5 h-8 text-xs ${floating ? 'bg-[#d4af37] text-black hover:bg-[#c9a227]' : ''}`}
                      onClick={() => handleSendCategory(cat)}
                    >
                      {isSent ? <Check className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                      {isSent ? '已发送' : '发送关键词'}
                    </Button>
                  </div>
                  <button
                    onClick={() => onOptimizePrompt(cat.text, 'enhance')}
                    className={`mt-2 text-[11px] flex items-center gap-1 ${floating ? 'text-[#d4af37] hover:text-[#e6c34d]' : 'text-primary hover:underline'}`}
                  >
                    <Wand2 className="w-3 h-3" />用此关键词继续优化
                  </button>
                </div>
              );
            })}

            {/* Negative Prompt */}
            {result.negative_prompt && (
              <div className={`rounded-lg p-3 ${floating ? 'bg-[#2a1a1a] border border-red-900/40' : 'bg-destructive/5'}`}>
                <div className="text-xs font-medium text-destructive mb-1">反向提示词（随发送一并附带）</div>
                <p className={`text-xs ${floating ? 'text-gray-300' : 'text-muted-foreground'}`}>{result.negative_prompt}</p>
              </div>
            )}

            <Button variant="ghost" size="sm"
              className={`w-full gap-1.5 ${floating ? 'text-gray-300 hover:text-white hover:bg-[#333]' : ''}`}
              style={accent ? undefined : undefined}
              onClick={resetTab}>
              <RotateCcw className="w-3.5 h-3.5" />重新识词
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Agent Enhance Tab - AI增强（提示词大师）
// ============================================
interface AgentEnhanceTabProps {
  initialPrompt?: string;
  onInsertPrompt: (prompt: string, negative?: string) => void;
  onClose: () => void;
  floating?: boolean;
}

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

function AgentEnhanceTab({ initialPrompt, onInsertPrompt, onClose, floating }: AgentEnhanceTabProps) {
  const [input, setInput] = useState(initialPrompt || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const quickModes: Array<{ id: string; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }> = [
    { id: 'enhance', label: '增强', icon: Zap, desc: '添加细节，提升质量' },
    { id: 'expand', label: '扩展', icon: Sparkles, desc: '丰富场景，增加元素' },
    { id: 'refine', label: '精简', icon: Wand2, desc: '去除冗余，保留核心' },
    { id: 'cinematic', label: '电影感', icon: Sparkles, desc: '添加电影摄影参数' },
    { id: 'detailed', label: '高细节', icon: Sparkles, desc: '精细纹理和材质描述' },
  ];

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const handleSubmit = useCallback(async (mode?: string) => {
    const text = input.trim();
    if (!text || isStreaming) return;
    
    const userMsg: ChatMessage = { role: 'user', content: mode ? `[${mode}] ${text}` : text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setStreamingText('');
    setIsStreaming(true);
    
    abortRef.current = new AbortController();
    
    try {
      const result = await optimizeWithAgent(text, messages, abortRef.current.signal, (partial) => {
        setStreamingText(partial);
      });
      setMessages(prev => [...prev, { role: 'assistant', content: result }]);
    } catch (e: unknown) {
      if (!(e instanceof Error) || e.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: '优化失败，请重试' }]);
      }
    } finally {
      setIsStreaming(false);
      setStreamingText('');
    }
  }, [input, isStreaming, messages]);

  const handleInsertLast = useCallback(() => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) {
      onInsertPrompt(lastAssistant.content);
    }
  }, [messages, onInsertPrompt]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Quick modes */}
      <div className="px-4 pt-3">
        <div className="text-xs text-muted-foreground mb-2">快捷优化模式</div>
        <div className="flex flex-wrap gap-1.5">
          {quickModes.map(m => {
            const IconComponent = m.icon;
            return (
            <button key={m.id} onClick={() => handleSubmit(m.id)} disabled={isStreaming || !input.trim()}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border border-border bg-background hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50">
              <IconComponent className="w-3 h-3" />{m.label}
            </button>
          );})}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">输入提示词，AI帮你优化</p>
            <p className="text-xs mt-1 opacity-70">支持：增强细节、扩展场景、精简优化、电影感、高细节</p>
          </div>
        )}
        
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap
              ${msg.role === 'user' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted/70 text-foreground'}`}>
              {msg.content}
              {msg.role === 'assistant' && (
                <button onClick={() => onInsertPrompt(msg.content)}
                  className={`mt-2 text-xs flex items-center gap-1 ${floating ? 'text-[#d4af37]' : 'text-primary'} hover:underline`}>
                  <Send className="w-3 h-3" />使用此提示词
                </button>
              )}
            </div>
          </div>
        ))}
        
        {isStreaming && streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm bg-muted/70 text-foreground whitespace-pre-wrap">
              {streamingText}
              <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5" />
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className={`p-3 border-t ${floating ? 'border-[#333]' : 'border-border'}`}>
        <div className="flex gap-2">
          <Textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入原始提示词..."
            className={`min-h-[60px] text-sm resize-none ${floating ? 'bg-[#2a2a2a] border-[#444] text-white' : ''}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Button size="sm" className="shrink-0" disabled={isStreaming || !input.trim()} onClick={() => handleSubmit()}>
            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="w-full mt-2 text-xs text-primary" onClick={handleInsertLast}>
            使用最新优化结果
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================
// Vision API Result Type (must match API response)
// ============================================
export interface VisionLangBlock {
  title?: string;
  prompt?: string;
  analysis?: string;
}
export interface VisionApiResultData {
  zh?: VisionLangBlock;
  en?: VisionLangBlock;
  zh_style_tags?: string[];
  en_style_tags?: string[];
  zh_json?: Record<string, string | string[]>;
  en_json?: Record<string, string | string[]>;
  json_prompt?: Record<string, string | string[]>;
  confidence?: number;
  raw?: string;
  // legacy backward-compat
  keywords?: string[];
  negative_prompt?: string;
  description?: string;
  style?: string;
}

// ============================================
// Main Component
// ============================================
interface OhMyPromptProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertPrompt: (prompt: string, negativePrompt?: string) => void;
  onOptimizePrompt?: (prompt: string, mode: string) => void;
  onVisionPrompt?: (url: string) => void;
  initialImageUrl?: string;
  initialPrompt?: string;
  initialTab?: OmpActiveTab;
  themeStyle?: 'gold' | 'default';
  floating?: boolean;
  // 受控模式 - 用于画布右键菜单调用
  defaultActiveTab?: OmpActiveTab;
  autoAnalyzeImageUrl?: string | null;
  isVisionAnalyzing?: boolean;
  visionResult?: VisionApiResultData | null;
}

export default function OhMyPrompt({
  isOpen,
  onClose,
  onInsertPrompt,
  onOptimizePrompt,
  onVisionPrompt,
  initialImageUrl,
  initialPrompt,
  initialTab = 'agent',
  themeStyle = 'default',
  floating = false,
  defaultActiveTab,
  autoAnalyzeImageUrl,
  isVisionAnalyzing: externalIsAnalyzing,
  visionResult: externalVisionResult,
}: OhMyPromptProps) {
  const [activeTab, setActiveTab] = useState<OmpActiveTab>(defaultActiveTab || initialTab);
  const settings = loadSettings();

  // Drag state — initialize to viewport center to avoid flash at (0,0)
  const [position, setPosition] = useState(() => {
    if (typeof window !== 'undefined') {
      return {
        x: Math.max(0, (window.innerWidth - 320) / 2),
        y: Math.max(0, (window.innerHeight - 520) / 2),
      };
    }
    return { x: 0, y: 0 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, offsetX: 0, offsetY: 0, dragging: false });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (defaultActiveTab) setActiveTab(defaultActiveTab);
  }, [defaultActiveTab, isOpen]);

  // Center the panel on mount (both floating and non-floating)
  useEffect(() => {
    if (!isOpen) return;
    // Delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect();
        setPosition({
          x: Math.max(0, (window.innerWidth - rect.width) / 2),
          y: Math.max(0, (window.innerHeight - rect.height) / 2),
        });
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX - position.x;
    const startY = e.clientY - position.y;
    dragRef.current = { startX, startY, offsetX: position.x, offsetY: position.y, dragging: true };
    setIsDragging(true);
  }, [position]);

  const handleDragMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    e.preventDefault();
    setPosition({
      x: Math.max(0, e.clientX - dragRef.current.startX),
      y: Math.max(0, e.clientY - dragRef.current.startY),
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    dragRef.current.dragging = false;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    saveSettings({ visionDefaultFormat: settings.visionDefaultFormat });
  }, [settings.visionDefaultFormat]);

  const handleOptimize = useCallback((prompt: string, mode: string) => {
    setActiveTab('agent');
    if (onOptimizePrompt) {
      onOptimizePrompt(prompt, mode);
    }
  }, [onOptimizePrompt]);

  const handleVisionInsert = useCallback((prompt: string, negative?: string) => {
    if (onVisionPrompt) {
      onVisionPrompt(prompt);
    } else {
      onInsertPrompt(prompt, negative);
    }
  }, [onVisionPrompt, onInsertPrompt]);

  if (!isOpen) return null;

  const isGold = themeStyle === 'gold';
  const panelClass = floating
    ? 'fixed w-80 bg-[#1a1a1a] text-white rounded-xl shadow-2xl border border-[#333] overflow-hidden flex flex-col z-[200]'
    : 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm';
  const innerClass = floating
    ? 'w-full flex flex-col bg-[#1a1a1a]'
    : 'fixed w-full max-w-xl bg-background rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col';

  return (
    <div className={panelClass} onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onMouseLeave={handleDragEnd}
      style={floating ? { left: position.x, top: position.y } : undefined}>
      <div ref={panelRef} className={innerClass}
        style={floating
          ? { height: '520px', cursor: isDragging ? 'grabbing' : 'default' }
          : { height: '720px', maxHeight: '90vh', left: position.x, top: position.y, cursor: isDragging ? 'grabbing' : 'default' }
        }>
        {/* Header */}
        <div onMouseDown={handleDragStart} className={`flex items-center justify-between px-4 py-3 border-b cursor-grab active:cursor-grabbing select-none ${floating ? 'border-[#333]' : 'border-border bg-gradient-to-r from-primary/5 to-transparent'}`}>
          <div className="flex items-center gap-2">
            <Lightbulb className={`w-5 h-5 ${floating ? 'text-[#d4af37]' : 'text-primary'}`} />
            <h2 className={`text-base font-semibold ${floating ? 'text-white' : 'text-foreground'}`}>灵感工坊</h2>
          </div>
          <button onClick={onClose} className={floating ? 'text-muted-foreground hover:text-white' : 'text-muted-foreground hover:text-foreground'}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex px-4 py-2 gap-1 border-b ${floating ? 'border-[#333]' : 'border-border'}`}>
          {(['vision', 'agent'] as const).map(tab => {
            const label = tab === 'vision' ? '识词' : 'AI增强';
            const Icon = tab === 'vision' ? Eye : Wand2;
            const isActive = activeTab === tab;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                  ${isActive 
                    ? (floating ? 'bg-[#d4af37] text-black' : 'bg-primary/10 text-primary')
                    : (floating ? 'text-gray-400 hover:text-white hover:bg-[#333]' : 'text-muted-foreground hover:text-foreground hover:bg-muted')}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'vision' ? (
            <VisionTab 
              initialImageUrl={autoAnalyzeImageUrl || initialImageUrl}
              onInsertPrompt={handleVisionInsert}
              onOptimizePrompt={handleOptimize}
              externalResult={externalVisionResult}
              externalAnalyzing={externalIsAnalyzing}
              floating={floating}
            />
          ) : (
            <AgentEnhanceTab 
              initialPrompt={initialPrompt}
              onInsertPrompt={onInsertPrompt}
              onClose={onClose}
              floating={floating}
            />
          )}
        </div>
      </div>
    </div>
  );
}
