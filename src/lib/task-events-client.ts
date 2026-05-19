/**
 * 任务事件 SSE 客户端 + 取消功能
 *
 * 使用方式：
 *   import { taskEventsClient } from '@/lib/task-events-client';
 *
 *   // 连接SSE（自动重连）
 *   taskEventsClient.connect();
 *
 *   // 监听任务事件
 *   taskEventsClient.onTaskEvent((event) => { ... });
 *
 *   // 取消任务
 *   await taskEventsClient.cancelTask(taskId);
 */

import type { TaskInfo, TaskType } from './task-registry';

export interface TaskEvent {
  taskId: string;
  type: 'created' | 'updated' | 'completed' | 'failed' | 'cancelled' | 'progress' | 'queued';
  task: TaskInfo;
}

type TaskEventHandler = (event: TaskEvent) => void;

class TaskEventsClient {
  private eventSource: EventSource | null = null;
  private handlers: Set<TaskEventHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private connected = false;

  /** 连接SSE */
  connect(): void {
    if (this.eventSource) return; // 已连接

    try {
      const base = this.getBaseUrl();
      this.eventSource = new EventSource(`${base}/api/task-events`);

      this.eventSource.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
      };

      this.eventSource.onmessage = (e) => {
        if (e.data === 'heartbeat') return;
        try {
          const event = JSON.parse(e.data) as TaskEvent;
          this.handlers.forEach(h => {
            try { h(event); } catch { /* handler error */ }
          });
        } catch {
          // ignore parse errors
        }
      };

      this.eventSource.onerror = () => {
        this.connected = false;
        this.eventSource?.close();
        this.eventSource = null;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  /** 断开SSE */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.eventSource?.close();
    this.eventSource = null;
    this.connected = false;
    this.reconnectAttempts = 0;
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /** 注册事件处理器 */
  onTaskEvent(handler: TaskEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  /** 取消任务 */
  async cancelTask(taskId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const base = this.getBaseUrl();
      const resp = await fetch(`${base}/api/cancel-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      return await resp.json();
    } catch (err) {
      console.error('[TaskEventsClient] cancelTask error:', err);
      return { success: false, message: '取消请求失败' };
    }
  }

  private getBaseUrl(): string {
    if (typeof window !== 'undefined') {
      // 浏览器环境：使用当前域名
      return `${window.location.protocol}//${window.location.host}`;
    }
    return '';
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}

// 全局单例
export const taskEventsClient = new TaskEventsClient();
