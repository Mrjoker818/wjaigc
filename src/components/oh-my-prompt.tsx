'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Lightbulb, X, Upload, Wand2, Eye, Sparkles, Loader2, Copy, Check, Send, Image as ImageIcon, RotateCcw, ChevronDown, ChevronUp, Zap } from 'lucide-react';
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
async function analyzeVisionPrompt(imageDataUrl: string): Promise<VisionApiResultData> {
  const formData = new FormData();
  // Convert data URL to blob
  const response = await fetch(imageDataUrl);
  const blob = await response.blob();
  formData.append('image', blob, 'image.png');
  formData.append('mode', 'fast');
  
  const res = await fetch('/api/vision-prompt', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Vision analysis failed');
  const data = await res.json();
  return data as VisionApiResultData;
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
interface VisionTabProps {
  initialImageUrl?: string;
  onInsertPrompt: (prompt: string, negative?: string) => void;
  onOptimizePrompt: (prompt: string, mode: string) => void;
}

function VisionTab({ initialImageUrl, onInsertPrompt, onOptimizePrompt }: VisionTabProps) {
  const [imagePreview, setImagePreview] = useState<string>(initialImageUrl || '');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<VisionApiResultData | null>(null);
  const [outputFormat, setOutputFormat] = useState('comma');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setResult(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!imagePreview || isAnalyzing) return;
    setIsAnalyzing(true);
    setResult(null);
    try {
      const data = await analyzeVisionPrompt(imagePreview);
      setResult(data);
    } catch (error) {
      console.error('Vision analysis error:', error);
      alert('图片识词失败，请重试');
    } finally {
      setIsAnalyzing(false);
    }
  }, [imagePreview, isAnalyzing]);

  const getFormattedPrompt = useCallback(() => {
    if (!result?.keywords?.length) return '';
    const kws = result.keywords;
    switch(outputFormat) {
      case 'comma': return kws.join(', ');
      case 'dot': return kws.map(k => `・${k}`).join('\n');
      case 'bracket': return kws.map(k => `(${k})`).join(', ');
      default: return kws.join(', ');
    }
  }, [result, outputFormat]);

  const handleCopy = useCallback(async () => {
    const text = getFormattedPrompt();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [getFormattedPrompt]);

  return (
    <div className="h-full flex flex-col p-4 gap-3 overflow-hidden">
      <div className="flex-1 overflow-y-auto space-y-3">
        {/* Image Upload Area */}
        <div 
          className={`relative border-2 border-dashed rounded-xl transition-all cursor-pointer overflow-hidden
            ${imagePreview ? 'border-primary/30' : 'border-border hover:border-primary/50 hover:bg-muted/30'}`}
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
              <button onClick={(e) => { e.stopPropagation(); setImagePreview(''); setResult(null); }}
                className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white hover:bg-black/80">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
              <Upload className="w-8 h-8 opacity-50" />
              <span className="text-xs">点击上传图片，AI自动识别关键词</span>
            </div>
          )}
        </div>

        {/* Analyze Button */}
        {imagePreview && !isAnalyzing && !result && (
          <Button onClick={handleAnalyze} className="w-full gap-2">
            <Eye className="w-4 h-4" />开始识词
          </Button>
        )}
        
        {isAnalyzing && (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-sm">AI正在分析图片...</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            {/* Format selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">输出格式：</span>
              <div className="flex gap-1">
                {[
                  { v: 'comma', label: '逗号分隔' },
                  { v: 'dot', label: '要点' },
                  { v: 'bracket', label: '加权' },
                ].map(f => (
                  <button key={f.v} onClick={() => setOutputFormat(f.v)}
                    className={`px-2 py-0.5 text-xs rounded-md transition-colors
                      ${outputFormat === f.v ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Keywords */}
            <div className="bg-muted/50 rounded-lg p-3 relative group">
              <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{getFormattedPrompt()}</pre>
              <button onClick={handleCopy}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background">
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            </div>

            {/* Negative Prompt */}
            {result.negative_prompt && (
              <div className="bg-destructive/5 rounded-lg p-3">
                <div className="text-xs font-medium text-destructive mb-1">反向提示词</div>
                <p className="text-xs text-muted-foreground">{result.negative_prompt}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={handleCopy}>
                <Copy className="w-3.5 h-3.5" />复制
              </Button>
              <Button size="sm" className="flex-1 gap-1.5" onClick={() => { onInsertPrompt(getFormattedPrompt(), result?.negative_prompt); }}>
                <Send className="w-3.5 h-3.5" />插入到生成器
              </Button>
            </div>
            
            <Button variant="ghost" size="sm" className="w-full gap-1.5 text-primary" 
              onClick={() => onOptimizePrompt(getFormattedPrompt(), 'enhance')}>
              <Wand2 className="w-3.5 h-3.5" />继续优化此提示词
            </Button>

            <Button variant="ghost" size="sm" className="w-full gap-1.5" onClick={() => { setImagePreview(''); setResult(null); }}>
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
    } catch (e: any) {
      if (e.name !== 'AbortError') {
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
export interface VisionApiResultData {
  keywords: string[];
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

  useEffect(() => {
    if (defaultActiveTab) setActiveTab(defaultActiveTab);
  }, [defaultActiveTab, isOpen]);

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
    ? 'absolute right-2 bottom-16 w-80 bg-[#1a1a1a] text-white rounded-xl shadow-2xl border border-[#333] overflow-hidden flex flex-col z-50'
    : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm';
  const innerClass = floating
    ? 'w-full flex flex-col bg-[#1a1a1a]'
    : 'w-full max-w-xl bg-background rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col';

  return (
    <div className={panelClass}>
      <div className={innerClass} style={floating ? { height: '520px' } : { height: '720px', maxHeight: '90vh' }}>
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${floating ? 'border-[#333]' : 'border-border bg-gradient-to-r from-primary/5 to-transparent'}`}>
          <div className="flex items-center gap-2">
            <Lightbulb className={`w-5 h-5 ${floating ? 'text-[#d4af37]' : 'text-primary'}`} />
            <h2 className={`text-base font-semibold ${floating ? 'text-white' : 'text-foreground'}`}>灵感工坊</h2>
          </div>
          <button onClick={onClose} className={floating ? 'text-gray-400 hover:text-white' : 'text-muted-foreground hover:text-foreground'}>
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
