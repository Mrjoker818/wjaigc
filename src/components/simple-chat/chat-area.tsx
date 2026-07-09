'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Send, ImagePlus, Sparkles, Bot, User, Zap, Paperclip, X, Wand2, ChevronDown, Loader2 } from 'lucide-react';
import { ChatMessage, ChatSession, ToolStatus, ImageResult } from '@/types/simple-chat';

interface ChatAreaProps {
  session: ChatSession | null;
  onBackToWorkspace: () => void;
  onNewSession: (session: ChatSession) => void;
  onUpdateSession: (s: ChatSession) => void;
  sidebarOpen: boolean;
}

interface AvailableModel {
  id: string;
  name: string;
  providerId: string;
  icon: string;
}

const MODEL_ICONS = ['⚡', '🚀', '💎', '🎨', '🧠', '🔥', '✨', '💡', '🌟', '🪄'];

const QUICK_COMMANDS = [
  { trigger: '@生成图片', label: '生成图片', desc: '描述想要的画面' },
  { trigger: '@优化提示词', label: '优化提示词', desc: '将简单描述扩展为专业提示词' },
  { trigger: '@分析图片', label: '分析图片', desc: '上传图片进行内容分析' },
  { trigger: '@修图建议', label: '修图建议', desc: '分析图片并给出修图建议' },
];

export default function ChatArea({ session, onBackToWorkspace, onNewSession, onUpdateSession, sidebarOpen }: ChatAreaProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(session?.messages || []);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedModel, setSelectedModel] = useState(session?.model || '');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState(session?.providerId || '');
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 动态获取可用模型列表
  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      let data: { models?: Array<{ id: string; name: string; providerId: string }>; providers?: Array<{ selectedModels?: string[]; id: string }> } | null = null;
      try {
        setModelsLoading(true);
        const res = await fetch('/api/models?type=chat');
        if (!res.ok) throw new Error('Failed to load models');
        data = await res.json();
        const models: AvailableModel[] = [];
        const seen = new Set<string>();
        const modelsList = (data?.models || []) as { id: string; name: string; providerId: string }[];
        modelsList.forEach((m, idx) => {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            models.push({
              id: m.id,
              name: m.name || m.id,
              providerId: m.providerId || '',
              icon: MODEL_ICONS[idx % MODEL_ICONS.length],
            });
          }
        });
        if (!cancelled) {
          setAvailableModels(models);
          if (models.length > 0 && !selectedModel) {
            setSelectedModel(models[0].id);
            setSelectedProviderId(models[0].providerId);
          } else if (models.length > 0 && selectedModel && !models.some(m => m.id === selectedModel)) {
            // 当前选中的模型不在可用列表中，回退到第一个
            setSelectedModel(models[0].id);
            setSelectedProviderId(models[0].providerId);
          }
        }
      } catch {
        if (!cancelled) {
          // 回退到管理员配置中的聊天模型
          const fallback: AvailableModel[] = [];
          (data?.providers || []).forEach((p: { selectedModels?: string[]; id: string }) => {
            (p.selectedModels || []).forEach((mid, idx) => {
              fallback.push({ id: mid, name: mid, providerId: p.id, icon: MODEL_ICONS[idx % MODEL_ICONS.length] });
            });
          });
          if (fallback.length > 0) {
            setAvailableModels(fallback);
            if (!selectedModel) {
              setSelectedModel(fallback[0].id);
              setSelectedProviderId(fallback[0].providerId);
            }
          }
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }
    loadModels();
    return () => { cancelled = true; };
  }, []);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <Bot className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
          <p className="text-muted-foreground">请选择一个会话或创建新会话</p>
        </div>
      </div>
    );
  }

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // 同步 session
  useEffect(() => {
    const updated: ChatSession = { ...session, messages, model: selectedModel, providerId: selectedProviderId, updatedAt: Date.now() };
    onUpdateSession(updated);
  }, [messages, selectedModel, selectedProviderId]);

  // 处理 @ 快捷命令
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (val.endsWith('@')) {
      setShowCommands(true);
    } else {
      setShowCommands(false);
    }
  };

  const applyCommand = (cmd: typeof QUICK_COMMANDS[number]) => {
    setInput(prev => prev.replace(/@$/, '') + cmd.trigger + ' ');
    setShowCommands(false);
    inputRef.current?.focus();
  };

  // 处理图片上传
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedImages(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const removeImage = (idx: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== idx));
  };

  // 发送消息
  const handleSend = async () => {
    const content = input.trim();
    if (!content && uploadedImages.length === 0) return;
    if (isStreaming) return;

    const userMsg: ChatMessage = {
      id: 'user-' + Date.now(),
      role: 'user',
      content,
      uploadedImages: uploadedImages.length > 0 ? [...uploadedImages] : undefined,
      timestamp: Date.now(),
    };

    const aiMsg: ChatMessage = {
      id: 'ai-' + Date.now(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolStatuses: [],
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setInput('');
    setUploadedImages([]);
    setIsStreaming(true);

    try {
      const res = await fetch('/api/simple-chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({
            role: m.role,
            content: m.content,
          })),
          model: selectedModel,
          providerId: selectedProviderId,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          try {
            const data = JSON.parse(jsonStr);

            setMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx < 0) return updated;

              switch (data.type) {
                case 'text':
                  fullText += data.content;
                  updated[lastIdx] = { ...updated[lastIdx], content: fullText };
                  break;
                case 'tool_status': {
                  const existingTools = updated[lastIdx].toolStatuses || [];
                  const toolType = data.tool as ToolStatus['type'];
                  const newTool: ToolStatus = {
                    type: toolType,
                    label: data.label || '',
                    timestamp: Date.now(),
                    status: data.status,
                    progress: data.progress,
                    taskId: data.taskId,
                  };
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    toolStatuses: [
                      ...existingTools.filter((t: ToolStatus) => t.type !== toolType),
                      newTool,
                    ],
                  };
                  break;
                }
                case 'image':
                  updated[lastIdx] = {
                    ...updated[lastIdx],
                    images: [
                      ...(updated[lastIdx].images || []),
                      { url: data.imageUrl, prompt: data.prompt || '', width: 1024, height: 1024 } as ImageResult,
                    ],
                    toolStatuses: (updated[lastIdx].toolStatuses || []).filter(
                      (t: ToolStatus) => t.type !== 'generating_image'
                    ),
                  };
                  break;
                case 'done':
                  break;
                case 'error':
                  updated[lastIdx] = { ...updated[lastIdx], content: fullText || data.error };
                  break;
              }
              return updated;
            });
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0) {
          updated[lastIdx] = { ...updated[lastIdx], content: `错误: ${errMsg}` };
        }
        return updated;
      });
    }
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentModel = availableModels.find(m => m.id === selectedModel) || { id: selectedModel, name: selectedModel, icon: '🤖' };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/50 backdrop-blur-sm shrink-0">
        <button
          onClick={onBackToWorkspace}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">返回工作台</span>
        </button>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowModelMenu(!showModelMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm cursor-pointer"
            >
              {modelsLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <span>{currentModel.icon}</span>
              )}
              <span className="font-medium">{modelsLoading ? '加载模型...' : currentModel.name}</span>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            {showModelMenu && (
              <div className="absolute top-full mt-1 right-0 w-64 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden max-h-80 overflow-y-auto">
                {availableModels.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-muted-foreground">
                    {modelsLoading ? '正在加载可用模型...' : '暂无可用模型，请在管理员面板配置聊天模型'}
                  </div>
                ) : (
                  availableModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedModel(m.id); setSelectedProviderId(m.providerId); setShowModelMenu(false); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors cursor-pointer ${m.id === selectedModel ? 'bg-primary/10 text-primary' : 'text-foreground'}`}
                    >
                      <span>{m.icon}</span>
                      <span className="truncate">{m.name}</span>
                      {m.id === selectedModel && <span className="ml-auto text-primary text-xs shrink-0">✓</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <h2 className="text-sm font-semibold text-foreground truncate max-w-[150px]">{session.title}</h2>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-6" data-modal="true" data-popup="true">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">开始对话</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                输入 @ 使用快捷命令，或直接描述你想要生成的图片
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}

              <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                {/* 用户消息 */}
                {msg.role === 'user' && (
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-md px-4 py-2.5">
                    {msg.uploadedImages && msg.uploadedImages.length > 0 && (
                      <div className="flex gap-2 mb-2 flex-wrap">
                        {msg.uploadedImages.map((img: string, i: number) => (
                          <img key={i} src={img} alt="upload" className="w-16 h-16 rounded-lg object-cover" />
                        ))}
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                )}

                {/* AI 消息 */}
                {msg.role === 'assistant' && (
                  <div className="bg-card border border-border rounded-2xl rounded-tl-md px-4 py-3">
                    {/* 工具状态 */}
                    {msg.toolStatuses && msg.toolStatuses.length > 0 && (
                      <div className="mb-3 space-y-2">
                        {msg.toolStatuses.map((ts: ToolStatus, i: number) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-xs">
                            {(ts.status === 'generating' || ts.status === 'polling') ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                            ) : ts.status === 'failed' ? (
                              <X className="w-3.5 h-3.5 text-destructive" />
                            ) : (
                              <Zap className="w-3.5 h-3.5 text-primary" />
                            )}
                            <span className="text-muted-foreground">{ts.label}</span>
                            {ts.progress !== undefined && ts.progress > 0 && (
                              <span className="text-primary ml-auto">{ts.progress}%</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 文字内容 */}
                    {msg.content ? (
                      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed text-foreground">
                        {msg.content}
                        {isStreaming && msg.id === messages[messages.length - 1]?.id && (
                          <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                        )}
                      </p>
                    ) : (
                      isStreaming && msg.id === messages[messages.length - 1]?.id && !msg.toolStatuses?.length && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          思考中...
                        </div>
                      )
                    )}

                    {/* 生成的图片 */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {msg.images.map((img: ImageResult, i: number) => (
                          <div key={i} className="relative group">
                            <img
                              src={img.url}
                              alt={img.prompt || 'Generated'}
                              className="w-full max-w-sm rounded-xl border border-border/50"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100">
                              <button
                                onClick={() => window.open(img.url, '_blank')}
                                className="px-3 py-1.5 bg-black/60 text-white text-xs rounded-lg cursor-pointer"
                              >
                                查看大图
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 快捷命令面板 */}
      {showCommands && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-card border border-border rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto" data-popup="true">
          {QUICK_COMMANDS.map(cmd => (
            <button
              key={cmd.trigger}
              onClick={() => applyCommand(cmd)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-medium text-foreground">{cmd.label}</div>
                <div className="text-xs text-muted-foreground">{cmd.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 输入区 */}
      <div className="relative shrink-0 border-t border-border/50 bg-card/30 backdrop-blur-sm px-4 py-3">
        <div className="max-w-3xl mx-auto">
          {/* 已上传图片预览 */}
          {uploadedImages.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {uploadedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img} alt="upload" className="w-16 h-16 rounded-lg object-cover border border-border" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 bg-muted/50 rounded-2xl border border-border/50 px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
            {/* 上传按钮 */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
              title="上传图片"
            >
              <ImagePlus className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />

            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，@ 使用快捷命令..."
              rows={1}
              className="flex-1 bg-transparent resize-none text-sm placeholder:text-muted-foreground/50 focus:outline-none py-2 max-h-32"
              disabled={isStreaming}
            />

            <button
              onClick={handleSend}
              disabled={(!input.trim() && uploadedImages.length === 0) || isStreaming}
              className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            >
              {isStreaming ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>

          <p className="text-xs text-muted-foreground/50 text-center mt-2">
            输入 @ 使用快捷命令 · Shift+Enter 换行 · Enter 发送
          </p>
        </div>
      </div>
    </div>
  );
}
