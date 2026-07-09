/** 简洁聊天页面的类型定义 */

// ============ 消息相关 ============
export type ChatRole = 'user' | 'assistant' | 'system';

export interface ToolStatus {
  type: 'thinking' | 'searching' | 'generating_image' | 'reading' | 'executing';
  label: string;
  detail?: string;
  timestamp: number;
  status?: 'running' | 'completed' | 'error' | 'generating' | 'polling' | 'failed';
  progress?: number;
  taskId?: string;
}

export interface ImageResult {
  url: string;
  width: number;
  height: number;
  prompt: string;
  model?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  images?: ImageResult[];
  uploadedImages?: string[];
  toolStatuses?: ToolStatus[];
  isStreaming?: boolean;
  isError?: boolean;
  errorMessage?: string;
}

// ============ 会话相关 ============
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  providerId: string;
  messages: ChatMessage[];
  pinned?: boolean;
}

// ============ Agent / 项目相关 ============
export interface AgentProject {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'archived' | 'completed';
  type: 'general' | 'image' | 'video' | 'design' | 'brand' | 'custom';
}

export interface AgentTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: {
    type: 'image' | 'text' | 'link' | 'file';
    url?: string;
    content?: string;
  };
  agentId?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  providerId: string;
  temperature: number;
  maxTokens: number;
  tools: string[];
  createdAt: number;
  updatedAt: number;
}

// ============ 快捷命令 ============
export interface QuickCommand {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  category: 'generate' | 'edit' | 'analyze' | 'design' | 'other';
}

// ============ 后端 API 类型 ============
export interface ChatStreamEvent {
  type: 'text' | 'tool_start' | 'tool_end' | 'tool_status' | 'image_start' | 'image_progress' | 'image_complete' | 'error' | 'done';
  content?: string;
  tool?: string;
  status?: string;
  label?: string;
  taskId?: string;
  progress?: number;
  image?: Partial<ImageResult> & { taskId?: string };
  error?: string;
}

export interface SimpleChatRequest {
  messages: { role: ChatRole; content: string }[];
  model: string;
  providerId: string;
  stream?: boolean;
  referenceImages?: string[];
  sessionId?: string;
}

export interface SimpleGenerateRequest {
  prompt: string;
  model: string;
  providerId: string;
  size?: string;
  quality?: string;
  referenceImages?: string[];
}

export interface SimpleGenerateResponse {
  success: boolean;
  taskId?: string;
  mode?: 'polling';
  estimatedTime?: number;
  error?: string;
}
